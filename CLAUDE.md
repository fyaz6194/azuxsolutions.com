# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single-page static marketing site for **AZUX Solutions** (azuxsolutions.com), centered on the **Chatbot-DateTime** natural-language datetime parser demo. Hosted on GitHub Pages — the `CNAME` file points the apex domain at the site, and there is no build step. Files at the repo root (`index.html`, `styles.css`, `script.js`) are served verbatim.

There is no package manager, no test runner, no linter, and no CI config. "Deploy" = push to `main`; GitHub Pages serves the new files.

## Running locally

Any static file server works. Quick options from the repo root:

```powershell
python -m http.server 8000     # then open http://localhost:8000
# or
npx serve .
```

Opening `index.html` directly via `file://` mostly works, but the live-API `fetch` call to the Lambda URL is fine from `file://` (CORS allows it) — the local-fallback path triggers only on network/CORS errors.

## Architecture notes

**Two-tier datetime parsing in `script.js`.** The demo posts user phrases to a public AWS Lambda Function URL (`API_URL` constant, hardcoded — `ap-south-1`) and renders the JSON response. On *any* failure (network, CORS, or queue-full), it falls back to a JS reimplementation of the same parser (`parsePhrase`) so the demo never appears broken. The fallback intentionally produces the same response shape as the Lambda (`datetime`, `assumption[]`, `treated_as`, `valid_window`, or `_error`/`error`) so the renderers don't branch on source.

**Lambda call serialization.** `callLambda` chains all requests through a single `lambdaChain` promise (one request in flight at a time) and caps queued callers at `MAX_QUEUE = 5`; the 6th caller throws `queue_full` and is routed to the local fallback. This exists because the hero and main demo can both fire on page load and on Enter — without serialization they'd stampede the Lambda. If you add another caller (e.g. a third widget), it shares this queue automatically; do not add a parallel queue.

**Fixed assumptions in the local parser.** Timezone is hardcoded to IST (`IST_OFFSET_MIN = 330`), date order defaults to DMY, and the validity window is `WINDOW_DAYS = 3` from "now". These mirror the Lambda's defaults — if the Lambda's defaults change, update the fallback to match or the demo will silently diverge depending on which path served the request.

**Two demo widgets share parsing logic** but render differently: `run()` (the full JSON viewer with syntax highlighting via `highlightJson`) and `runHero()` (the compact hero card). Chips with `data-value` attributes auto-fill and submit. Both call `callLambda` first, then `parsePhrase` on failure.

**SEO-heavy `index.html`.** The file is ~50KB and contains substantial inline JSON-LD structured data (Organization, SoftwareApplication, etc.), Open Graph / Twitter meta, and Bing/Google verification tags. Recent commits show active tuning of `<title>` and meta description length for Bing/Google limits — preserve those length constraints when editing. Search-engine verification artifacts at the repo root (`62d2507049bc4d138e4bffeac2479cd6.txt` is the IndexNow key, `BingSiteAuth.xml` was removed in favor of DNS CNAME verification) should not be renamed or deleted casually.

**`sitemap.xml` lists hash anchors** (`/#about`, `/#features`, …) as separate URLs — when you add or rename a section in `index.html`, update `sitemap.xml` to match.

## Things that bite

- The Lambda URL is hardcoded in `script.js` and points to a specific function in `ap-south-1`. There is no env-var indirection.
- `script.js` is loaded as a classic script (not a module) and runs top-to-bottom on DOMContentLoaded; it expects every element ID it touches (`year`, `demo-text`, `hero-input`, etc.) to exist in `index.html`. Removing an ID from the HTML without updating the JS will throw at load.
- Both `run()` and `runHero()` are called immediately on page load (lines 281 and 348) for first-render — this means two Lambda calls fire on every page view, which is why the serialized queue exists.
