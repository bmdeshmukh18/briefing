// NSE Pulse — Main App (bootstrap, router, renderer)
import { navigatorDates, getLatestDate, isDateAccessible, buildSeo, adminNotesDecision } from './lib/core.js';
import { DataAccess } from './lib/data-access.js';
import { initCharts, refreshChartTheme } from './charts.js';
import { initTracker } from './tracker.js';

// ── Formatting helpers ────────────────────────────────────────────
const NULL_DISPLAY = '—';

function fmt(v, decimals = 2) {
  if (v === null || v === undefined) return NULL_DISPLAY;
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtChange(v) {
  if (v === null || v === undefined) return `<span class="null-placeholder">${NULL_DISPLAY}</span>`;
  const cls = v >= 0 ? 'positive' : 'negative';
  const sign = v >= 0 ? '+' : '';
  return `<span class="${cls} mono">${sign}${Number(v).toFixed(2)}%</span>`;
}

function fmtFlow(v) {
  if (v === null || v === undefined) return `<span class="null-placeholder">${NULL_DISPLAY}</span>`;
  const abs = Math.abs(v).toFixed(1);
  const sign = v >= 0 ? '+' : '-';
  return `<span class="mono ${v >= 0 ? 'positive' : 'negative'}">₹${sign}${abs} Cr</span>`;
}

function fmtNum(v) {
  if (v === null || v === undefined) return `<span class="null-placeholder">${NULL_DISPLAY}</span>`;
  return `<span class="mono">${Number(v).toLocaleString('en-IN')}</span>`;
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Theme management ──────────────────────────────────────────────
const THEMES = ['terminal', 'daylight', 'dusk', 'forest'];
const LIGHT_THEMES = ['daylight'];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('nse-pulse-theme', theme);
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === theme);
  });
  const isDark = !LIGHT_THEMES.includes(theme);
  const toggleBtn = document.getElementById('toggle-dark-btn');
  if (toggleBtn) toggleBtn.textContent = isDark ? '☀' : '☾';
  try { refreshChartTheme(); } catch {}
}

function initTheme() {
  const saved = localStorage.getItem('nse-pulse-theme') ?? 'terminal';
  applyTheme(saved);

  document.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => applyTheme(swatch.dataset.theme));
  });

  document.getElementById('toggle-dark-btn')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme ?? 'terminal';
    applyTheme(LIGHT_THEMES.includes(current) ? 'terminal' : 'daylight');
  });
}

// ── Skeleton ──────────────────────────────────────────────────────
function showSkeleton() {
  document.getElementById('skeleton-screen').hidden = false;
  document.getElementById('briefing-root').hidden = true;
  document.getElementById('error-root').hidden = true;
}

function hideSkeleton() {
  document.getElementById('skeleton-screen').hidden = true;
}

function showError(msg) {
  hideSkeleton();
  document.getElementById('error-root').hidden = false;
  document.getElementById('error-root').innerHTML = `<div class="error-banner">${esc(msg)}</div>`;
  document.getElementById('briefing-root').hidden = true;
}

// ── Date navigator ────────────────────────────────────────────────
function populateNavigator(index, selectedDate) {
  const sel = document.getElementById('date-nav');
  if (!sel) return;
  sel.innerHTML = '';
  navigatorDates(index).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    if (d === selectedDate) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    window.location.href = `?date=${sel.value}`;
  });
}

// ── Renderer helpers ──────────────────────────────────────────────
function renderSection(title, bodyHTML, id, collapsible = false, defaultOpen = true) {
  const colClass = collapsible ? 'collapsible-section' : '';
  const bodyClass = collapsible && !defaultOpen ? 'section-body mobile-collapse' : 'section-body';
  const toggleHTML = collapsible
    ? `<span class="section-toggle ${defaultOpen ? 'open' : ''}" aria-hidden="true">▾</span>`
    : '';
  return `
    <div class="section-card ${colClass}" id="${id}">
      <div class="section-header" ${collapsible ? 'role="button" tabindex="0" aria-expanded="' + defaultOpen + '"' : ''}>
        <span class="section-title">${esc(title)}</span>
        ${toggleHTML}
      </div>
      <div class="${bodyClass}">${bodyHTML}</div>
    </div>`;
}

function renderHeroStrip(summary) {
  const n50 = summary.nifty50 ?? {};
  const sx = summary.sensex ?? {};
  const flows = summary.institutional_flows ?? {};

  const pulsesvg = `<svg class="pulse-line" viewBox="0 0 80 32" aria-hidden="true">
    <path d="M0 20 L15 20 L20 6 L26 28 L32 4 L38 24 L44 20 L80 20"/>
  </svg>`;

  return `<div class="hero-strip full-width">
    <div class="hero-card nifty-card">
      <div class="card-label">Nifty 50</div>
      <div class="card-value mono">${n50.close !== null && n50.close !== undefined ? Number(n50.close).toLocaleString('en-IN', {minimumFractionDigits:1,maximumFractionDigits:1}) : NULL_DISPLAY}</div>
      <div class="card-change">${fmtChange(n50.change_pct)}</div>
      ${pulsesvg}
    </div>
    <div class="hero-card">
      <div class="card-label">Sensex</div>
      <div class="card-value mono">${sx.close !== null && sx.close !== undefined ? Number(sx.close).toLocaleString('en-IN', {minimumFractionDigits:1,maximumFractionDigits:1}) : NULL_DISPLAY}</div>
      <div class="card-change">${fmtChange(sx.change_pct)}</div>
    </div>
    <div class="hero-card">
      <div class="card-label">FII Net Flow</div>
      <div class="card-value" style="font-size:1.4rem">${fmtFlow(flows.fii_net_cr)}</div>
      <div class="card-sub">Institutional</div>
    </div>
    <div class="hero-card">
      <div class="card-label">DII Net Flow</div>
      <div class="card-value" style="font-size:1.4rem">${fmtFlow(flows.dii_net_cr)}</div>
      <div class="card-sub">Institutional</div>
    </div>
  </div>`;
}

function renderSnapshot(summary, meta) {
  const breadth = summary.breadth ?? {};
  const sectors = summary.sectors ?? {};
  const adv = breadth.nifty500_advances;
  const dec = breadth.nifty500_declines;
  const total = (adv ?? 0) + (dec ?? 0);
  const advPct = total > 0 ? ((adv / total) * 100).toFixed(0) : 50;

  const leadersHTML = (sectors.leaders ?? []).length
    ? (sectors.leaders ?? []).map(s => `<span class="sector-tag leader">${esc(s)}</span>`).join('')
    : `<span class="empty-msg">No entries available</span>`;
  const laggardsHTML = (sectors.laggards ?? []).length
    ? (sectors.laggards ?? []).map(s => `<span class="sector-tag laggard">${esc(s)}</span>`).join('')
    : `<span class="empty-msg">No entries available</span>`;

  const body = `
    ${meta.market_tone ? `<div class="tone-badge">${esc(meta.market_tone)}</div>` : ''}
    <div class="breadth-visual">
      <div class="breadth-track">
        <div class="breadth-adv" style="width:${advPct}%"></div>
        <div class="breadth-dec"></div>
      </div>
      <div class="breadth-labels">
        <span class="positive">${adv !== null && adv !== undefined ? `▲ ${adv} Advances` : NULL_DISPLAY}</span>
        <span class="negative">${dec !== null && dec !== undefined ? `▼ ${dec} Declines` : NULL_DISPLAY}</span>
      </div>
    </div>
    <div class="sector-groups">
      <div class="sector-group"><h4>Leaders</h4><div class="sector-tags">${leadersHTML}</div></div>
      <div class="sector-group"><h4>Laggards</h4><div class="sector-tags">${laggardsHTML}</div></div>
    </div>`;
  return renderSection('Market Snapshot', body, 'section-snapshot');
}

function renderMovers(summary) {
  const gainersHTML = summary.key_gainers?.length
    ? `<table class="data-table"><thead><tr><th>Symbol</th><th>Change</th></tr></thead><tbody>
        ${summary.key_gainers.map(g => `<tr><td>${esc(g.symbol)}</td><td>${fmtChange(g.change_pct)}</td></tr>`).join('')}
       </tbody></table>`
    : `<p class="empty-msg">No entries available</p>`;

  const losersHTML = summary.key_losers?.length
    ? `<table class="data-table"><thead><tr><th>Symbol</th><th>Change</th></tr></thead><tbody>
        ${summary.key_losers.map(l => `<tr><td>${esc(l.symbol)}</td><td>${fmtChange(l.change_pct)}</td></tr>`).join('')}
       </tbody></table>`
    : `<p class="empty-msg">No entries available</p>`;

  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div><h4 style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Top Gainers</h4>${gainersHTML}</div>
      <div><h4 style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Top Losers</h4>${losersHTML}</div>
    </div>`;
  return renderSection('Movers', body, 'section-movers');
}

function renderMacro(summary, triggers, isMobile) {
  const macro = summary.macro ?? {};
  const domList = triggers.domestic ?? [];
  const globList = triggers.global ?? [];

  const domesticHTML = domList.length
    ? `<ul class="trigger-list">${domList.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
    : `<p class="empty-msg">No entries available</p>`;
  const globalHTML = globList.length
    ? `<ul class="trigger-list">${globList.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
    : `<p class="empty-msg">No entries available</p>`;

  const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div class="metric-row" style="flex-direction:column;align-items:flex-start;gap:.2rem">
        <span class="metric-label">Brent Crude</span>
        <span class="metric-value">${macro.brent_crude !== null && macro.brent_crude !== undefined ? `$${Number(macro.brent_crude).toFixed(2)}` : NULL_DISPLAY}</span>
      </div>
      <div class="metric-row" style="flex-direction:column;align-items:flex-start;gap:.2rem">
        <span class="metric-label">India 10Y Yield</span>
        <span class="metric-value mono">${macro.india_10y_yield !== null && macro.india_10y_yield !== undefined ? `${Number(macro.india_10y_yield).toFixed(2)}%` : NULL_DISPLAY}</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div><h4 style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4rem">Domestic</h4>${domesticHTML}</div>
      <div><h4 style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4rem">Global</h4>${globalHTML}</div>
    </div>`;
  return renderSection('Macro & Triggers', body, 'section-macro', true, !isMobile);
}

function renderDeepDive(deep_dive, isMobile) {
  const text = deep_dive?.full_text;
  const body = text
    ? `<div style="font-size:.88rem;line-height:1.75;color:var(--text-primary)">${esc(text).replace(/\n/g, '<br>')}</div>`
    : `<p class="empty-msg">No deep dive available.</p>`;
  return renderSection('Deep Dive', body, 'section-deepdive', true, !isMobile);
}

function renderOutlook(outlook, isMobile) {
  const scenarios = outlook?.scenarios ?? [];
  const baseCase = outlook?.base_case;
  const supports = outlook?.support_levels ?? [];
  const resistances = outlook?.resistance_levels ?? [];
  const watches = outlook?.key_watch ?? [];

  const scenariosHTML = scenarios.length
    ? `<div class="scenario-list">
        ${scenarios.map(s => `
          <div class="scenario-item">
            <div class="scenario-header">
              <span class="scenario-name">${esc(s.name)}</span>
              <span class="scenario-prob">${s.probability}%</span>
            </div>
            <div class="prob-track">
              <div class="probability-bar" style="--prob:${s.probability}"></div>
            </div>
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:.2rem">
              ${fmtNum(s.range_low)} – ${fmtNum(s.range_high)}
            </div>
          </div>`).join('')}
       </div>`
    : `<p class="empty-msg">No scenarios available</p>`;

  const supportsHTML = supports.length
    ? `<div class="levels-row">${supports.map(v => `<span class="level-chip support">${Number(v).toLocaleString('en-IN')}</span>`).join('')}</div>`
    : `<p class="empty-msg">No entries available</p>`;
  const resistHTML = resistances.length
    ? `<div class="levels-row">${resistances.map(v => `<span class="level-chip resistance">${Number(v).toLocaleString('en-IN')}</span>`).join('')}</div>`
    : `<p class="empty-msg">No entries available</p>`;
  const watchHTML = watches.length
    ? `<div class="watch-list">${watches.map(w => `<span class="watch-chip">${esc(w)}</span>`).join('')}</div>`
    : `<p class="empty-msg">No entries available</p>`;

  const body = `
    ${baseCase ? `<p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:1rem;font-style:italic">${esc(baseCase)}</p>` : ''}
    ${scenariosHTML}
    <div style="margin-top:1.25rem">
      <div style="margin-bottom:.75rem">
        <h4 style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.3rem">Support Levels</h4>
        ${supportsHTML}
      </div>
      <div style="margin-bottom:.75rem">
        <h4 style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.3rem">Resistance Levels</h4>
        ${resistHTML}
      </div>
      <div>
        <h4 style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.3rem">Key Watch</h4>
        ${watchHTML}
      </div>
    </div>`;
  return renderSection('Outlook', body, 'section-outlook', true, !isMobile);
}

function renderPredictionResult(pr) {
  if (!pr) return '';
  const tag = pr.accuracy_tag;
  if (!tag) return '';
  const tagClass = tag === 'Correct' ? 'tag-positive' : tag === 'Wrong' ? 'tag-negative' : 'tag-neutral';
  const body = `
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <span class="tag ${tagClass}">${esc(tag)}</span>
      <span class="text-secondary text-sm">Actual close: <span class="mono">${fmtNum(pr.actual_close)}</span></span>
      ${pr.matched_scenario ? `<span class="text-secondary text-sm">Matched: <em>${esc(pr.matched_scenario)}</em></span>` : ''}
    </div>`;
  return renderSection('Yesterday\'s Prediction Result', body, 'section-prediction');
}

function wireCollapsibles(isMobile) {
  document.querySelectorAll('.collapsible-section').forEach(card => {
    const header = card.querySelector('.section-header');
    const body = card.querySelector('.section-body');
    const toggle = card.querySelector('.section-toggle');
    if (!header || !body) return;

    if (isMobile) body.classList.add('mobile-collapse');
    else body.classList.remove('mobile-collapse');

    header.addEventListener('click', () => {
      const isOpen = !body.classList.contains('mobile-collapse') || body.classList.contains('open');
      if (isMobile) {
        body.classList.toggle('open', !isOpen);
      } else {
        body.style.display = isOpen ? 'none' : '';
      }
      toggle?.classList.toggle('open', !isOpen);
      header.setAttribute('aria-expanded', String(!isOpen));
    });

    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
    });
  });
}

// ── Main render ───────────────────────────────────────────────────
async function renderBriefing(briefing) {
  const isMobile = window.innerWidth < 768;
  const seo = buildSeo(briefing);
  document.title = seo.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', seo.description);

  const root = document.getElementById('briefing-root');
  root.innerHTML = '';

  // Admin notes
  const adminDecision = adminNotesDecision(briefing, DataAccess.config.adminViewEnabled);

  const sections = [
    renderHeroStrip(briefing.summary),
    `<div class="briefing-grid">`,
    renderSnapshot(briefing.summary, briefing.meta),
    renderMovers(briefing.summary),
    renderMacro(briefing.summary, briefing.triggers, isMobile),
    renderDeepDive(briefing.deep_dive, isMobile),
    renderOutlook(briefing.outlook, isMobile),
    renderPredictionResult(briefing.prediction_result),
    `</div>`,
    `<div class="section-card full-width" id="section-charts" style="margin-top:1.25rem">
       <div class="section-header"><span class="section-title">Historical Charts</span></div>
       <div id="charts-root"></div>
     </div>`,
    `<div class="section-card full-width" id="section-tracker" style="margin-top:1.25rem">
       <div class="section-header"><span class="section-title">Prediction Accuracy</span></div>
       <div id="tracker-root" style="padding:1.25rem"></div>
     </div>`,
    adminDecision.show ? `<div class="section-card full-width" style="margin-top:1.25rem">
       <div class="section-header"><span class="section-title">Admin Notes</span></div>
       <div class="section-body"><p style="font-size:.85rem">${esc(adminDecision.notes)}</p></div>
     </div>` : '',
  ];

  root.innerHTML = `<div class="main-content">${sections.join('')}</div>`;
  root.hidden = false;
  hideSkeleton();

  wireCollapsibles(isMobile);
}

// ── Bootstrap ─────────────────────────────────────────────────────
async function bootstrap() {
  initTheme();
  showSkeleton();

  let index;
  try {
    index = await DataAccess.getIndex();
  } catch {
    showError('Briefing list is unavailable. Please try again later.');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  let requestedDate = params.get('date');
  const latestDate = DataAccess.getLatestDate(index);

  if (!requestedDate) {
    requestedDate = latestDate;
  } else if (!isDateAccessible(requestedDate, index)) {
    showError(`No briefing is available for "${esc(requestedDate)}".`);
    populateNavigator(index, null);
    return;
  }

  populateNavigator(index, requestedDate);

  if (!requestedDate) {
    showError('No briefings are available yet.');
    return;
  }

  let briefing;
  try {
    briefing = await DataAccess.getBriefing(requestedDate);
  } catch {
    hideSkeleton();
    document.getElementById('error-root').hidden = false;
    document.getElementById('error-root').innerHTML =
      `<div class="main-content"><div class="error-banner">The briefing for ${esc(requestedDate)} could not be loaded.</div></div>`;
    document.getElementById('briefing-root').hidden = true;
    return;
  }

  if (briefing.meta?.session_status === 'Holiday') {
    showError(`No trading session occurred on ${esc(requestedDate)}.`);
    return;
  }

  await renderBriefing(briefing);

  // Load charts and tracker after briefing is visible
  initCharts().catch(() => {});
  initTracker(index).catch(() => {});
}

document.addEventListener('DOMContentLoaded', bootstrap);
