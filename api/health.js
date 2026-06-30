// Vercel Serverless Function — latency probe for the datetime backend.
//
// Pings the backend's /health endpoint server-side and reports how long the
// round trip took from Vercel's perspective (the number that actually reflects
// what end users experience). The backend URL stays private in the Vercel env
// var PARSE_HEALTH, never in client code or this repo.
//
// GET /api/health           -> single probe
// GET /api/health?n=5       -> n probes (capped), with min/avg/max summary
module.exports = async (req, res) => {
  const url = process.env.PARSE_HEALTH;
  if (!url) {
    res.status(500).json({ _error: 'health_not_configured' });
    return;
  }

  // How many samples to take (1..10).
  const q = new URL(req.url, 'http://x').searchParams;
  let n = parseInt(q.get('n') || '1', 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 10) n = 10;

  const samples = [];
  let lastStatus = 0;
  let lastBody = null;

  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(url, { method: 'GET' });
      const body = await r.text();
      const ms = performance.now() - t0;
      lastStatus = r.status;
      try { lastBody = JSON.parse(body); } catch { lastBody = body; }
      samples.push(Number(ms.toFixed(2)));
    } catch (e) {
      const ms = performance.now() - t0;
      samples.push(Number(ms.toFixed(2)));
      lastStatus = 502;
      lastBody = { _error: 'upstream_unreachable' };
    }
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2));

  // Don't let the browser cache a latency probe.
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    backend_status: lastStatus,
    backend_body: lastBody,
    latency_ms: { samples, min, avg, max },
    region: process.env.VERCEL_REGION || null,
  });
};
