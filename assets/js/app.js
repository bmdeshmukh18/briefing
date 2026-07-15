// NSE Pulse — bootstrap, hash router (#/YYYY-MM-DD), page assembly
import { navigatorDates, getLatestDate, isDateAccessible, buildSeo, rollingAccuracy } from './lib/core.js';
import { DataAccess } from './lib/data-access.js';
import * as V from './views.js';
import { initCharts, wireChartTabs } from './charts.js';

const $ = id => document.getElementById(id);
const state = { index: null, briefingCache: new Map() };

async function getBriefing(date) {
  if (!state.briefingCache.has(date)) {
    state.briefingCache.set(date, DataAccess.getBriefing(date).catch(err => {
      state.briefingCache.delete(date); // don't cache failures
      throw err;
    }));
  }
  return state.briefingCache.get(date);
}

function dateFromHash() {
  const m = location.hash.match(/^#\/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

function showError(message) {
  $('skeleton').hidden = true;
  $('root').hidden = true;
  const el = $('error-root');
  el.innerHTML = V.renderError(message);
  el.hidden = false;
}

function fillDateNav(dates, selected) {
  const sel = $('date-nav');
  sel.innerHTML = dates.map(d => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join('');
  const asc = [...dates].reverse(); // navigatorDates() is desc; asc for prev/next math
  const i = asc.indexOf(selected);
  $('nav-prev').disabled = i <= 0;
  $('nav-next').disabled = i < 0 || i >= asc.length - 1;
}

async function renderDate(date) {
  $('error-root').hidden = true;
  $('root').hidden = true;
  $('skeleton').hidden = false;

  const dates = state.index.dates;
  fillDateNav(navigatorDates(state.index), date);

  let briefing;
  try {
    briefing = await getBriefing(date);
  } catch {
    showError(`The briefing for ${date} could not be loaded.`);
    return;
  }

  // Previous briefing (for the verdict panel) — best-effort.
  const prevDate = [...dates].filter(d => d < date).sort().at(-1) ?? null;
  let prevBriefing = null;
  if (prevDate) {
    try { prevBriefing = await getBriefing(prevDate); } catch { /* verdict degrades gracefully */ }
  }

  const seo = buildSeo(briefing);
  document.title = seo.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', seo.description);

  const wide = matchMedia('(min-width: 768px)').matches;
  $('root').innerHTML = [
    V.renderVerdict(prevBriefing, prevDate, briefing, date),
    V.renderToday(briefing, date),
    V.renderDeepDive(briefing, wide),
    V.renderTomorrow(briefing),
    V.renderRecordShell(),
  ].join('');

  $('skeleton').hidden = true;
  $('root').hidden = false;

  wireChartTabs($('root'));
  loadRecord();   // async fill: accuracy calendar + chip
  loadCharts();   // async fill: history charts
}

async function loadRecord() {
  const body = $('record-body');
  try {
    const last30 = state.index.dates.slice(-30);
    const briefings = await Promise.all(last30.map(d => getBriefing(d).catch(() => null)));
    const tagged = last30.map((date, i) => ({
      date,
      accuracy_tag: briefings[i]?.prediction_result?.accuracy_tag ?? null,
    }));
    const rolling = rollingAccuracy(tagged);
    if (body) body.innerHTML = V.renderRecordBody(tagged, rolling);

    const chip = $('accuracy-chip');
    if (rolling.state === 'percentage') {
      chip.innerHTML = `<b>${rolling.value}%</b>&nbsp;correct`;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  } catch {
    if (body) body.innerHTML = '<p class="empty-note">Track record is unavailable.</p>';
  }
}

async function loadCharts() {
  try {
    const history = await DataAccess.getHistory();
    initCharts(history);
  } catch {
    document.querySelectorAll('.chart-panel').forEach(p => {
      p.innerHTML = '<p class="empty-note">Historical chart data is unavailable.</p>';
    });
  }
}

function route() {
  const requested = dateFromHash();
  const latest = getLatestDate(state.index);

  if (!requested) {
    if (!latest) { showError('No briefings are available yet.'); return; }
    renderDate(latest);
    return;
  }
  if (!isDateAccessible(requested, state.index)) {
    showError(`No briefing is available for ${location.hash.slice(2)}.`);
    fillDateNav(navigatorDates(state.index), null);
    return;
  }
  renderDate(requested);
}

async function boot() {
  try {
    state.index = await DataAccess.getIndex();
  } catch {
    showError('The briefing list is unavailable.');
    return;
  }

  $('date-nav').addEventListener('change', e => { location.hash = `#/${e.target.value}`; });
  $('nav-prev').addEventListener('click', () => stepDate(-1));
  $('nav-next').addEventListener('click', () => stepDate(1));
  addEventListener('hashchange', route);

  route();
}

function stepDate(delta) {
  const asc = [...state.index.dates].sort();
  const current = dateFromHash() ?? getLatestDate(state.index);
  const i = asc.indexOf(current) + delta;
  if (i >= 0 && i < asc.length) location.hash = `#/${asc[i]}`;
}

boot();
