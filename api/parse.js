// Vercel Serverless Function — same-origin proxy for the datetime parser.
//
// The browser calls /api/parse over HTTPS (azuxsolutions.com). This function
// forwards the request server-side to the real backend, so:
//   - no mixed-content block (the HTTP hop is server->server, not in the browser)
//   - the backend host never appears in client code, DevTools, or this repo.
//
// The backend URL lives ONLY in the Vercel env var PARSE_BACKEND (set via the
// Vercel dashboard or `vercel env add PARSE_BACKEND`), never committed to git.
//
// Connection keep-alive: the backend is a small home-hosted box reached through
// Cloudflare -> Oracle -> Pi. Establishing a *fresh* connection to it can stall
// for several seconds, while a reused one responds in ~10ms. The module-scoped
// keep-alive agents below hold TCP sockets open across invocations of a warm
// instance, so requests stay on the fast path. Pair with an external keep-warm
// ping to /api/parse (~1/min) so an instance stays alive to hold those sockets.
const http = require('http');
const https = require('https');

const AGENT_OPTS = { keepAlive: true, keepAliveMsecs: 30000, maxSockets: 4 };
const httpAgent = new http.Agent(AGENT_OPTS);
const httpsAgent = new https.Agent(AGENT_OPTS);
const UPSTREAM_TIMEOUT_MS = 9000;

// POST a JSON payload to the backend over a pooled keep-alive socket.
function postUpstream(urlStr, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const request = lib.request(
      u,
      {
        method: 'POST',
        agent: isHttps ? httpsAgent : httpAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (upstream) => {
        let body = '';
        upstream.setEncoding('utf8');
        upstream.on('data', (chunk) => { body += chunk; });
        upstream.on('end', () => resolve({ status: upstream.statusCode, body }));
      }
    );
    request.on('error', reject);
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => request.destroy(new Error('upstream_timeout')));
    request.write(payload);
    request.end();
  });
}

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
    const upstream = await postUpstream(backend, JSON.stringify({ text }));
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(upstream.body);
  } catch (e) {
    res.status(502).json({ _error: 'upstream_unreachable' });
  }
};
