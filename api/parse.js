// Vercel Serverless Function — same-origin proxy for the datetime parser.
//
// The browser calls /api/parse over HTTPS (azuxsolutions.com). This function
// forwards the request server-side to the real backend, so:
//   - no mixed-content block (the HTTP hop is server->server, not in the browser)
//   - the backend host never appears in client code, DevTools, or this repo.
//
// The backend URL lives ONLY in the Vercel env var PARSE_BACKEND (set via the
// Vercel dashboard or `vercel env add PARSE_BACKEND`), never committed to git.
module.exports = async (req, res) => {
  const backend = process.env.PARSE_BACKEND;
  if (!backend) {
    res.status(500).json({ _error: 'backend_not_configured' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ _error: 'method_not_allowed' });
    return;
  }
  // Accept only a short { text } phrase. Strip everything else and cap the
  // length so the backend never receives oversized payloads.
  const MAX_TEXT = 200;
  let data = req.body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  const text = data && typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) {
    res.status(400).json({ _error: 'missing_text' });
    return;
  }
  if (text.length > MAX_TEXT) {
    res.status(413).json({ _error: 'text_too_long' });
    return;
  }
  try {
    const upstream = await fetch(backend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const out = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(out);
  } catch (e) {
    res.status(502).json({ _error: 'upstream_unreachable' });
  }
};
