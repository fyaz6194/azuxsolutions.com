// ---------- Footer year & today stamps ----------
const NOW = new Date();
document.getElementById('year').textContent = NOW.getFullYear();

const journeyToday = document.getElementById('journey-today');
if (journeyToday) {
  const BASELINE = new Date('2026-04-16T00:00:00Z');
  const MS_PER_DAY = 86400000;
  const startOfToday = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate());
  const days = Math.max(1, Math.floor((startOfToday - BASELINE.getTime()) / MS_PER_DAY) + 1);
  const plural = days === 1 ? 'day' : 'days';
  journeyToday.textContent = `(Day ${days} · source-visible since 16 Apr 2026)`;
}

// ---------- Mobile nav ----------
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
if (toggle) {
  toggle.addEventListener('click', () => links.classList.toggle('open'));
  links.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => links.classList.remove('open'))
  );
}

// ---------- Live Lambda API ----------
const API_URL = 'https://sevw27tphlhneffoe32sx7mbe40thfql.lambda-url.ap-south-1.on.aws/parse';

async function callLambda(text) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

// ---------- Local fallback parser ----------
// Used when the Lambda call fails (CORS, network, etc.)

const ASSUMPTION = {
  TZ:    { code: 1, label: 'default_timezone_india' },
  DMY:   { code: 2, label: 'default_date_order_dmy' },
  YEAR:  { code: 3, label: 'current_year_injected' },
  TWOY:  { code: 4, label: 'two_digit_year_expanded' },
  SPACE: { code: 5, label: 'space_separated_normalized' },
};
const IST_OFFSET_MIN = 330;
const WINDOW_DAYS = 3;

function isoUtc(date) {
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return (
    date.getUTCFullYear() + '-' +
    pad(date.getUTCMonth() + 1) + '-' +
    pad(date.getUTCDate()) + 'T' +
    pad(date.getUTCHours()) + ':' +
    pad(date.getUTCMinutes()) + ':' +
    pad(date.getUTCSeconds()) + '.' +
    pad(date.getUTCMilliseconds(), 3) + 'Z'
  );
}

function istToUtc(y, m, d, h, mi) {
  const utcMs = Date.UTC(y, m - 1, d, h, mi, 0) - IST_OFFSET_MIN * 60 * 1000;
  return new Date(utcMs);
}

const MONTHS = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,
  january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
};

function parsePhrase(raw) {
  const now = new Date();
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const assumptions = [ASSUMPTION.TZ];

  let m = text.match(/^(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+from\s+now$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const ms = unit.startsWith('min') || unit === 'mins' ? n * 60000
             : unit.startsWith('hr') || unit.startsWith('hour') ? n * 3600000
             : n * 86400000;
    return buildResponse(new Date(now.getTime() + ms), assumptions, now);
  }

  m = text.match(/^(today|tomorrow|yesterday)(?:\s+at)?\s*(.*)$/);
  if (m) {
    const dayWord = m[1], rest = m[2];
    const shift = dayWord === 'today' ? 0 : dayWord === 'tomorrow' ? 1 : -1;
    const base = new Date(now.getTime() + shift * 86400000);
    const t = parseTime(rest) || { h: 9, mi: 0 };
    const dt = istToUtc(base.getFullYear(), base.getMonth() + 1, base.getDate(), t.h, t.mi);
    return buildResponse(dt, assumptions, now);
  }

  m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(.*))?$/);
  if (m) {
    let [, d, mo, y, timePart] = m;
    d = +d; mo = +mo; y = +y;
    if (y < 100) { y += 2000; assumptions.push(ASSUMPTION.TWOY); }
    assumptions.push(ASSUMPTION.DMY);
    const t = timePart ? parseTime(timePart) : { h: 0, mi: 0 };
    if (!t) return errorOut(12, 'unparseable', `Could not parse time in "${raw}".`, now);
    const dt = istToUtc(y, mo, d, t.h, t.mi);
    return buildResponse(dt, assumptions, now);
  }

  m = text.match(/^(\d{1,2})[\s\/\-]+([a-z]+)[\s\/\-]+(\d{2,4})(?:\s+(.*))?$/);
  if (m) {
    let [, d, monStr, y, timePart] = m;
    const mo = MONTHS[monStr];
    if (!mo) return errorOut(12, 'unparseable', `Unknown month "${monStr}".`, now);
    d = +d; y = +y;
    if (y < 100) { y += 2000; assumptions.push(ASSUMPTION.TWOY); }
    assumptions.push(ASSUMPTION.DMY);
    const t = timePart ? parseTime(timePart) : { h: 0, mi: 0 };
    if (!t) return errorOut(12, 'unparseable', `Could not parse time in "${raw}".`, now);
    const dt = istToUtc(y, mo, d, t.h, t.mi);
    return buildResponse(dt, assumptions, now);
  }

  return errorOut(12, 'unparseable',
    `The phrase "${raw}" did not match any known format.`, now);
}

function parseTime(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  if (str === 'noon') return { h: 12, mi: 0 };
  if (str === 'midnight') return { h: 0, mi: 0 };
  const m = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

function buildResponse(dt, assumptions, now) {
  const start = now;
  const end = new Date(now.getTime() + WINDOW_DAYS * 86400000);
  let treated, window;
  if (dt < start) {
    treated = { code: 1, label: 'past' };
    window  = { code: 2, label: 'past_allowed', start: isoUtc(start), end: isoUtc(end) };
  } else if (dt > end) {
    return {
      _error: true,
      error: { code: 11, label: 'out_of_range_future', message: `Parsed datetime is beyond the ${WINDOW_DAYS}-day validity window.` },
      window: { start: isoUtc(start), end: isoUtc(end) },
      parsed: isoUtc(dt)
    };
  } else {
    treated = { code: 2, label: 'within_window' };
    window  = { code: 1, label: 'in_window', start: isoUtc(start), end: isoUtc(end) };
  }
  return {
    datetime: isoUtc(dt),
    assumption: assumptions,
    treated_as: treated,
    valid_window: window
  };
}

function errorOut(code, label, message, now) {
  const start = now;
  const end = new Date(now.getTime() + WINDOW_DAYS * 86400000);
  return {
    _error: true,
    error: { code, label, message },
    window: { start: isoUtc(start), end: isoUtc(end) }
  };
}

// ---------- Demo wiring ----------
const input = document.getElementById('demo-text');
const btn = document.getElementById('demo-go');
const out = document.getElementById('demo-result');
const sourceTag = document.getElementById('demo-source');
const statusTag = document.getElementById('demo-status');

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Tokenize pretty-printed JSON into a syntax-highlighted HTML string.
function highlightJson(json) {
  const esc = escapeHtml(json);
  return esc.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g,
    (m, str, colon, num, bool) => {
      if (str !== undefined) {
        if (colon) return `<span class="k">${str}</span>${colon}`;
        return `<span class="s">${str}</span>`;
      }
      if (num !== undefined) return `<span class="n">${num}</span>`;
      if (bool !== undefined) return `<span class="n">${bool}</span>`;
      return m;
    }
  );
}

function renderOutput(status, source, dataObj) {
  const ok = status < 400;
  const statusText = ok ? 'OK' : 'Unprocessable Entity';
  const headerLine = `<span class="c ${ok ? 'ok' : 'err'}">// ${status} ${statusText}</span>`;

  const body = highlightJson(JSON.stringify(dataObj, null, 2));
  out.innerHTML = `<code>${headerLine}\n\n${body}</code>`;

  statusTag.textContent = `${status} ${ok ? 'OK' : 'ERROR'}`;
  statusTag.className = 'status-badge ' + (ok ? 'ok' : 'err');
  sourceTag.textContent = source === 'live' ? 'Live API' : 'Local fallback';
  sourceTag.className = 'source-badge ' + (source === 'live' ? 'live' : 'local');
}

async function run() {
  const value = input.value.trim();
  if (!value) {
    out.innerHTML = '<code><span class="c">// Enter a phrase and press "Parse"</span></code>';
    statusTag.textContent = '';
    sourceTag.textContent = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Parsing…';
  out.innerHTML = '<code><span class="c">// Calling live API…</span></code>';
  statusTag.textContent = '';
  sourceTag.textContent = '';

  try {
    const resp = await callLambda(value);
    renderOutput(resp.status, 'live', resp.data);
  } catch (err) {
    const result = parsePhrase(value);
    const { _error, ...rest } = result;
    renderOutput(_error ? 422 : 200, 'local', rest);
  }

  btn.disabled = false;
  btn.textContent = 'Parse →';
}

btn.addEventListener('click', run);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
document.querySelectorAll('.chip').forEach(c =>
  c.addEventListener('click', () => { input.value = c.dataset.value; run(); })
);

run();

// ---------- Hero mini-demo ----------
const heroInput    = document.getElementById('hero-input');
const heroBtn      = document.getElementById('hero-go');
const heroStatus   = document.getElementById('hero-status');
const heroDt       = document.getElementById('hero-datetime');
const heroDetail   = document.getElementById('hero-detail');
const heroCard     = document.querySelector('.hero-tryit');

function renderHero(status, dataObj) {
  const ok = status < 400;
  heroCard.classList.toggle('is-error', !ok);

  heroStatus.textContent = `${status} ${ok ? 'OK' : 'ERR'}`;
  heroStatus.className = 'status-badge ' + (ok ? 'ok' : 'err');

  if (ok) {
    heroDt.textContent = dataObj.datetime || '—';
    const treated = dataObj.treated_as?.label || 'parsed';
    const assumptions = (dataObj.assumption || [])
      .map(a => a.label).filter(Boolean).join(', ');
    heroDetail.textContent =
      `treated_as: ${treated}` +
      (assumptions ? ` · assumptions: ${assumptions}` : '');
  } else {
    heroDt.textContent = dataObj.error?.label || 'error';
    heroDetail.textContent = dataObj.error?.message || 'Could not parse input.';
  }
}

async function runHero() {
  const value = heroInput.value.trim();
  if (!value) {
    heroDt.textContent = '—';
    heroDetail.textContent = 'Type a date or click a chip to see the canonical ISO output.';
    heroStatus.textContent = '';
    return;
  }
  heroBtn.disabled = true;
  heroBtn.textContent = '…';
  heroDetail.textContent = 'Calling live API…';

  try {
    const resp = await callLambda(value);
    renderHero(resp.status, resp.data);
  } catch (err) {
    const result = parsePhrase(value);
    const { _error, ...rest } = result;
    renderHero(_error ? 422 : 200, rest);
  }

  heroBtn.disabled = false;
  heroBtn.textContent = 'Parse →';
}

if (heroBtn) {
  heroBtn.addEventListener('click', runHero);
  heroInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runHero(); });
  document.querySelectorAll('.hero-chip').forEach(c =>
    c.addEventListener('click', () => { heroInput.value = c.dataset.value; runHero(); })
  );
  runHero(); // first render
}
