// NSE Pulse — view rendering (pure functions: data in, HTML string out)
import { classifyAccuracy } from './lib/core.js';

// ── Formatting (briefing JSON comes from an LLM-parsed email: escape all
//    strings, trust no field to be present) ─────────────────────────────
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);

export function fmtNum(v, digits = 2) {
  if (!isNum(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(v) {
  if (!isNum(v)) return '—';
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '•';
  return `${arrow} ${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function pctClass(v) {
  if (!isNum(v)) return 'flat';
  return v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
}

export function fmtCr(v) {
  if (!isNum(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}₹${Math.abs(v).toLocaleString('en-IN')} cr`;
}

function niceDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── The rail (signature element) ────────────────────────────────────────
// Scenario ranges as lanes on a shared price axis, with a marker where the
// market actually closed. All SVG numbers are computed; text is escaped.
const RAIL_W = 720;
const LANE_H = 40;
const PAD_X = 8;

function xScale(domainLo, domainHi) {
  const span = domainHi - domainLo || 1;
  return v => PAD_X + ((v - domainLo) / span) * (RAIL_W - 2 * PAD_X);
}

function railDomain(values) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.08, 20);
  return [lo - pad, hi + pad];
}

export function scenarioRail(scenarios, actualClose, verdict) {
  const lanes = (scenarios || []).filter(s => isNum(s.range_low) && isNum(s.range_high));
  if (!lanes.length) return '<p class="empty-note">No scenario ranges were given for this call.</p>';

  const values = lanes.flatMap(s => [s.range_low, s.range_high]);
  if (isNum(actualClose)) values.push(actualClose);
  const [lo, hi] = railDomain(values);
  const x = xScale(lo, hi);

  const sorted = [...lanes].sort((a, b) => a.range_low - b.range_low);
  const topH = 24, axisH = 26;
  const H = topH + sorted.length * LANE_H + axisH;

  const laneEls = sorted.map((s, i) => {
    const y = topH + i * LANE_H;
    const x1 = x(s.range_low), x2 = x(s.range_high);
    const inRange = isNum(actualClose) && actualClose >= s.range_low && actualClose <= s.range_high;
    const cls = !inRange ? 'dim' : (verdict && verdict.matched_scenario === s.name ? (verdict.accuracy_tag === 'Correct' ? 'hit' : 'near') : 'hit');
    return `
      <text class="lane-name" x="${PAD_X}" y="${y + 9}">${esc(s.name ?? '')} <tspan class="lane-range">· ${isNum(s.probability) ? s.probability + '%' : '—'}</tspan></text>
      <rect class="lane-band ${cls}" x="${x1}" y="${y + 14}" width="${Math.max(x2 - x1, 2)}" height="16" rx="4"/>
      <text class="lane-range" x="${x1 - 6}" y="${y + 26}" text-anchor="end">${fmtNum(s.range_low, 0)}</text>
      <text class="lane-range" x="${x2 + 6}" y="${y + 26}">${fmtNum(s.range_high, 0)}</text>`;
  }).join('');

  let markerEl = '';
  if (isNum(actualClose)) {
    const mx = x(actualClose);
    const anchor = mx > RAIL_W - 130 ? 'end' : mx < 130 ? 'start' : 'middle';
    markerEl = `
      <g class="marker-group" style="--from:${(PAD_X - mx).toFixed(1)}px">
        <line class="marker-line" x1="${mx}" y1="14" x2="${mx}" y2="${H - axisH + 8}"/>
        <text class="marker-label" x="${mx}" y="10" text-anchor="${anchor}">CLOSED ${fmtNum(actualClose)}</text>
      </g>`;
  }

  return `
    <div class="rail-wrap">
      <svg class="rail-svg" viewBox="0 0 ${RAIL_W} ${H}" role="img"
           aria-label="Predicted scenario ranges${isNum(actualClose) ? ` against the actual close of ${fmtNum(actualClose)}` : ''}">
        <line class="rail-axis" x1="${PAD_X}" y1="${H - axisH + 8}" x2="${RAIL_W - PAD_X}" y2="${H - axisH + 8}"/>
        <text class="rail-axis-label" x="${PAD_X}" y="${H - 4}">${fmtNum(lo, 0)}</text>
        <text class="rail-axis-label" x="${RAIL_W - PAD_X}" y="${H - 4}" text-anchor="end">${fmtNum(hi, 0)}</text>
        ${laneEls}
        ${markerEl}
      </svg>
    </div>`;
}

// Support/resistance levels on a single axis, with today's close for context.
export function levelsRail(supports, resistances, lastClose) {
  const s = (supports || []).filter(isNum), r = (resistances || []).filter(isNum);
  if (!s.length && !r.length) return '<p class="empty-note">No levels were given.</p>';

  const values = [...s, ...r];
  if (isNum(lastClose)) values.push(lastClose);
  const [lo, hi] = railDomain(values);
  const x = xScale(lo, hi);
  const H = 84, mid = 46;

  const sEls = s.map((v, i) => `
    <line class="level-tick s" x1="${x(v)}" y1="${mid}" x2="${x(v)}" y2="${mid + 12}"/>
    <text class="level-label s" x="${x(v)}" y="${mid + 26}" text-anchor="middle">S${i + 1} ${fmtNum(v, 0)}</text>`).join('');
  const rEls = r.map((v, i) => `
    <line class="level-tick r" x1="${x(v)}" y1="${mid}" x2="${x(v)}" y2="${mid - 12}"/>
    <text class="level-label r" x="${x(v)}" y="${mid - 18}" text-anchor="middle">R${i + 1} ${fmtNum(v, 0)}</text>`).join('');
  const closeEl = isNum(lastClose)
    ? `<circle class="level-dot" cx="${x(lastClose)}" cy="${mid}" r="4"/>
       <text class="rail-axis-label" x="${x(lastClose)}" y="${mid - 34}" text-anchor="middle">close ${fmtNum(lastClose, 0)}</text>`
    : '';

  return `
    <div class="rail-wrap">
      <svg class="rail-svg" viewBox="0 0 ${RAIL_W} ${H}" role="img" aria-label="Support and resistance levels">
        <line class="rail-axis" x1="${PAD_X}" y1="${mid}" x2="${RAIL_W - PAD_X}" y2="${mid}"/>
        ${sEls}${rEls}${closeEl}
      </svg>
    </div>`;
}

// ── Verdict: did yesterday's call land? ─────────────────────────────────
// Uses the tracker-written prediction_result when present; otherwise computes
// a provisional verdict in-page from the current day's close (so the panel is
// informative even when the n8n tracker hasn't run).
export function resolveVerdict(prevBriefing, currentBriefing, prevDate, date) {
  const pr = prevBriefing?.prediction_result ?? {};
  const scenarios = prevBriefing?.outlook?.scenarios ?? [];
  if (pr.accuracy_tag) {
    return { ...pr, provisional: false };
  }
  // Mirror the n8n tracker's stale-gap rule: a call is only scored against the
  // IMMEDIATELY following session. ≤4 calendar days covers a weekend plus a
  // holiday; a wider gap means briefings are missing and the close is stale.
  const gapDays = prevDate && date ? (Date.parse(date) - Date.parse(prevDate)) / 86400000 : Infinity;
  if (gapDays > 4) {
    return { actual_close: null, accuracy_tag: null, matched_scenario: null, verified_at: null, provisional: false, stale: true, gapDays };
  }
  const actual = currentBriefing?.summary?.nifty50?.close ?? null;
  if (isNum(actual) && scenarios.length) {
    const c = classifyAccuracy(actual, scenarios);
    return {
      actual_close: actual,
      actual_change_pct: currentBriefing?.summary?.nifty50?.change_pct ?? null,
      matched_scenario: c.matched_scenario,
      accuracy_tag: c.accuracy_tag,
      verified_at: null,
      provisional: true,
    };
  }
  return { actual_close: null, accuracy_tag: null, matched_scenario: null, verified_at: null, provisional: false };
}

export function renderVerdict(prevBriefing, prevDate, currentBriefing, currentDate) {
  if (!prevBriefing) {
    return `
      <section class="verdict" aria-label="Yesterday's call">
        <div class="eyebrow">Yesterday’s call</div>
        <p class="empty-note">No prior call on record to verify — the ledger starts here.</p>
      </section>`;
  }

  const v = resolveVerdict(prevBriefing, currentBriefing, prevDate, currentDate);
  const base = prevBriefing.outlook?.base_case;
  const stampCls = { Correct: 'correct', Partial: 'partial', Wrong: 'wrong' }[v.accuracy_tag] ?? 'pending';
  const stampText = v.accuracy_tag ? v.accuracy_tag : v.stale ? 'Unscored' : 'Awaiting close';

  const meta = v.accuracy_tag
    ? `Closed at <b>${fmtNum(v.actual_close)}</b> (<span class="${pctClass(v.actual_change_pct)}">${fmtPct(v.actual_change_pct)}</span>)
       ${v.matched_scenario ? ` — landed in <b>${esc(v.matched_scenario)}</b>` : ' — outside every called range'}
       ${v.provisional
          ? '<div class="provisional-note">provisional — computed on this page; the tracker hasn’t verified it yet</div>'
          : v.verified_at ? `<div class="provisional-note">verified ${esc(String(v.verified_at).slice(0, 16).replace('T', ' '))} UTC</div>` : ''}`
    : v.stale
      ? `<div class="provisional-note">Unscored — briefings for the sessions right after this call are missing (${Math.round(v.gapDays)}-day gap), so there is no honest close to score it against.</div>`
      : '<div class="provisional-note">The next session hasn’t closed (or its briefing hasn’t arrived), so this call is still open.</div>';

  return `
    <section class="verdict" aria-label="Yesterday's call">
      <div class="eyebrow">Yesterday’s call <span class="eyebrow-date">${esc(niceDate(prevDate))}</span></div>
      <div class="verdict-head">
        <p class="verdict-base">${base ? `<span class="q">“</span>${esc(base)}<span class="q">”</span>` : '<span class="q">No base case was stated.</span>'}</p>
        <span class="stamp ${stampCls}">${esc(stampText)}</span>
      </div>
      ${scenarioRail(prevBriefing.outlook?.scenarios, v.actual_close, v)}
      <div class="verdict-meta">${meta}</div>
    </section>`;
}

// ── Today ───────────────────────────────────────────────────────────────
function heroCard(label, value, delta, deltaCls) {
  return `
    <div class="hero-card">
      <div class="hero-label">${label}</div>
      <div class="hero-value">${value}</div>
      <div class="hero-delta ${deltaCls ?? ''}">${delta ?? ''}</div>
    </div>`;
}

function chipRow(items, cls = '') {
  if (!items?.length) return '<p class="empty-note">No entries available.</p>';
  return `<div class="chip-row">${items.map(t => `<span class="chip ${cls}">${esc(t)}</span>`).join('')}</div>`;
}

function moverRows(movers) {
  if (!movers?.length) return '<p class="empty-note">No entries available.</p>';
  return movers.map(m => `
    <div class="mover-row">
      <span>${esc(m.symbol ?? '—')}</span>
      <span class="${pctClass(m.change_pct)}">${fmtPct(m.change_pct)}</span>
    </div>`).join('');
}

function triggerList(items) {
  if (!items?.length) return '<p class="empty-note">No entries available.</p>';
  return `<ul class="trigger-list">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function breadthBar(breadth) {
  const a = breadth?.nifty500_advances, d = breadth?.nifty500_declines;
  if (!isNum(a) || !isNum(d) || a + d === 0) {
    return '<div class="breadth-block"><p class="empty-note">Breadth data not available for this session.</p></div>';
  }
  const total = a + d;
  return `
    <div class="breadth-block">
      <div class="breadth-bar" role="img" aria-label="Nifty 500 breadth: ${a} advances, ${d} declines">
        <div class="adv" style="width:${(a / total * 100).toFixed(1)}%"></div>
        <div class="dec" style="width:${(d / total * 100).toFixed(1)}%"></div>
      </div>
      <div class="breadth-legend">
        <span><span class="pos">▲ ${a}</span> advances</span>
        <span>Nifty 500 breadth</span>
        <span>declines <span class="neg">▼ ${d}</span></span>
      </div>
    </div>`;
}

function macroChips(macro) {
  const defs = [
    ['Brent', macro?.brent_crude, '$'],
    ['USD/INR', macro?.usd_inr, '₹'],
    ['Gold', macro?.gold, '$'],
    ['India VIX', macro?.india_vix, ''],
    ['IN 10Y', macro?.india_10y_yield, '', '%'],
    ['US 10Y', macro?.us_10y_yield, '', '%'],
  ];
  const chips = defs.map(([label, v, pre, post]) =>
    `<span class="chip">${label} <b>${isNum(v) ? `${pre}${fmtNum(v)}${post ?? ''}` : '—'}</b></span>`).join('');
  return `<div class="chip-row">${chips}</div>`;
}

function globalChips(indices) {
  if (!indices?.length) return '<p class="empty-note">No entries available.</p>';
  return `<div class="chip-row">${indices.map(i =>
    `<span class="chip">${esc(i.name ?? '—')} <b class="${pctClass(i.change_pct)}">${fmtPct(i.change_pct)}</b></span>`).join('')}</div>`;
}

export function renderToday(b, date) {
  const s = b.summary ?? {};
  const holiday = b.meta?.session_status === 'Holiday';
  if (holiday) {
    return `
      <section aria-label="Today">
        <div class="eyebrow">Today <span class="eyebrow-date">${esc(niceDate(date))}</span></div>
        <p class="empty-note">No trading session — market holiday.</p>
      </section>`;
  }
  return `
    <section aria-label="Today">
      <div class="eyebrow">Today <span class="eyebrow-date">${esc(niceDate(date))}</span></div>
      <p class="tone-line"><span class="dash">—</span> ${b.meta?.market_tone ? esc(b.meta.market_tone) : 'No market tone recorded.'}</p>

      <div class="hero-grid">
        ${heroCard('Nifty 50', fmtNum(s.nifty50?.close), fmtPct(s.nifty50?.change_pct), pctClass(s.nifty50?.change_pct))}
        ${heroCard('Sensex', fmtNum(s.sensex?.close), fmtPct(s.sensex?.change_pct), pctClass(s.sensex?.change_pct))}
        ${heroCard('FII net', fmtCr(s.institutional_flows?.fii_net_cr), 'foreign flows', pctClass(s.institutional_flows?.fii_net_cr))}
        ${heroCard('DII net', fmtCr(s.institutional_flows?.dii_net_cr), 'domestic flows', pctClass(s.institutional_flows?.dii_net_cr))}
      </div>

      ${breadthBar(s.breadth)}

      <div class="today-grid">
        <div class="panel"><h3>Sector leaders</h3>${chipRow(s.sectors?.leaders, 'lead')}</div>
        <div class="panel"><h3>Sector laggards</h3>${chipRow(s.sectors?.laggards, 'lag')}</div>
        <div class="panel"><h3>Key gainers</h3>${moverRows(s.key_gainers)}</div>
        <div class="panel"><h3>Key losers</h3>${moverRows(s.key_losers)}</div>
        <div class="panel"><h3>Domestic triggers</h3>${triggerList(b.triggers?.domestic)}</div>
        <div class="panel"><h3>Global triggers</h3>${triggerList(b.triggers?.global)}</div>
        <div class="panel"><h3>Macro board</h3>${macroChips(s.macro)}</div>
        <div class="panel"><h3>Global indices</h3>${globalChips(s.global_indices)}</div>
      </div>
    </section>`;
}

// ── Deep dive ───────────────────────────────────────────────────────────
export function renderDeepDive(b, openByDefault) {
  const text = b.deep_dive?.full_text;
  const takeaway = b.deep_dive?.summary_takeaway;
  if (!text && !takeaway) return '';
  return `
    <section class="deepdive" aria-label="Deep dive">
      <div class="eyebrow">The read</div>
      <details ${openByDefault ? 'open' : ''}>
        <summary>Full session narrative</summary>
        <div class="deepdive-body">
          ${text ? `<p>${esc(text)}</p>` : ''}
          ${takeaway ? `<p class="takeaway">${esc(takeaway)}</p>` : ''}
        </div>
      </details>
    </section>`;
}

// ── Tomorrow (this briefing's outlook) ──────────────────────────────────
export function renderTomorrow(b) {
  const o = b.outlook ?? {};
  const scenarios = (o.scenarios ?? []).filter(s => s && s.name != null);
  const scenarioEls = scenarios.length ? scenarios.map(s => `
    <div class="scenario">
      <div class="scenario-head">
        <span class="scenario-name"><span class="scenario-prob">${isNum(s.probability) ? s.probability + '%' : '—'}</span> ${esc(s.name)}</span>
        <span class="scenario-range">${fmtNum(s.range_low, 0)} – ${fmtNum(s.range_high, 0)}</span>
      </div>
      <div class="prob-track"><div class="prob-fill" style="width:${isNum(s.probability) ? Math.min(Math.max(s.probability, 0), 100) : 0}%"></div></div>
    </div>`).join('') : '<p class="empty-note">No scenarios were called.</p>';

  const pr = b.prediction_result ?? {};
  const resolved = pr.accuracy_tag
    ? `<p class="resolved-note">This call has since resolved:
         <span class="tag-${pr.accuracy_tag.toLowerCase()}">${esc(pr.accuracy_tag)}</span>
         — closed ${fmtNum(pr.actual_close)}${pr.matched_scenario ? ` in “${esc(pr.matched_scenario)}”` : ''}.</p>`
    : '';

  return `
    <section aria-label="Next session outlook">
      <div class="eyebrow">Tomorrow — the call</div>
      <p class="verdict-base">${o.base_case ? `<span class="q">“</span>${esc(o.base_case)}<span class="q">”</span>` : '<span class="q">No base case stated.</span>'}</p>
      <div class="scenarios">${scenarioEls}</div>
      ${levelsRail(o.support_levels, o.resistance_levels, b.summary?.nifty50?.close)}
      <div class="panel" style="margin-top:1.25rem"><h3>Key watch</h3>${chipRow(o.key_watch)}</div>
      ${resolved}
    </section>`;
}

// ── Track record ────────────────────────────────────────────────────────
export function renderRecordShell() {
  return `
    <section aria-label="Track record">
      <div class="eyebrow">Track record</div>
      <div id="record-body"><p class="empty-note">Loading track record…</p></div>
      <div class="chart-tabs" role="tablist">
        <button class="chart-tab active" data-chart="nifty" role="tab" aria-selected="true">Nifty trend</button>
        <button class="chart-tab" data-chart="flows" role="tab" aria-selected="false">FII / DII</button>
        <button class="chart-tab" data-chart="breadth" role="tab" aria-selected="false">Breadth</button>
      </div>
      <div class="chart-panel" data-panel="nifty"><canvas id="chart-nifty"></canvas></div>
      <div class="chart-panel" data-panel="flows" hidden><canvas id="chart-flows"></canvas></div>
      <div class="chart-panel" data-panel="breadth" hidden><canvas id="chart-breadth"></canvas></div>
    </section>`;
}

export function renderRecordBody(tagged, rolling) {
  const verifiedCount = Math.min(tagged.filter(t => t.accuracy_tag).length, 30);
  const pct = rolling.state === 'percentage'
    ? `<div class="record-pct">${rolling.value}%<small>correct over last ${verifiedCount} verified call${verifiedCount === 1 ? '' : 's'}</small></div>`
    : rolling.state === 'no_correct'
      ? '<p class="empty-note">Verified calls exist, but none correct yet.</p>'
      : '<p class="empty-note">No verified calls yet — the first verdict lands after the next session closes.</p>';

  const days = tagged.slice(-30).map(t => {
    const cls = { Correct: 'correct', Partial: 'partial', Wrong: 'wrong' }[t.accuracy_tag] ?? '';
    return `<a class="cal-day ${cls}" href="#/${esc(t.date)}" title="${esc(t.date)}${t.accuracy_tag ? ` — ${esc(t.accuracy_tag)}` : ' — unverified'}" aria-label="${esc(t.date)}"></a>`;
  }).join('');

  return `
    <div class="record-top">
      ${pct}
      <div>
        <div class="cal-strip">${days}</div>
        <div class="cal-legend">last ${Math.min(tagged.length, 30)} briefings · <span class="pos">■</span> correct · <span style="color:var(--partial)">■</span> partial · <span class="neg">■</span> wrong · □ unverified</div>
      </div>
    </div>`;
}

// ── Errors ──────────────────────────────────────────────────────────────
export function renderError(message) {
  return `<p>${esc(message)}</p>`;
}
