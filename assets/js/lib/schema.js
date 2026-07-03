// Schema validation and normalization for NSE Pulse Per-Day JSON

const SESSION_STATUSES = ['Trading', 'Holiday'];
const ACCURACY_TAGS = ['Correct', 'Partial', 'Wrong', null];

function isString(v) { return typeof v === 'string'; }
function isNumber(v) { return typeof v === 'number' && isFinite(v); }
function isNullOrNumber(v) { return v === null || isNumber(v); }
function isNullOrString(v) { return v === null || isString(v); }
function isStringArray(v) { return Array.isArray(v) && v.every(isString); }

function validateScenario(s) {
  if (!s || typeof s !== 'object') return false;
  if (!isString(s.name) || s.name.length > 60) return false;
  if (!isNumber(s.probability) || s.probability < 0 || s.probability > 100) return false;
  if (!isNumber(s.range_low) || !isNumber(s.range_high)) return false;
  if (s.range_low > s.range_high) return false;
  return true;
}

function validateNamedChange(x) {
  return !!x && typeof x === 'object' && isString(x.name) && isNullOrNumber(x.change_pct);
}

export function validateBriefing(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const { meta, summary, triggers, deep_dive, outlook, prediction_result } = obj;

  // meta
  if (!meta || typeof meta !== 'object') return false;
  if (!isString(meta.date) || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) return false;
  if (!SESSION_STATUSES.includes(meta.session_status)) return false;
  if (!isNullOrString(meta.market_tone)) return false;
  if (isString(meta.market_tone) && meta.market_tone.length > 60) return false;
  if (meta.sources !== undefined && !isStringArray(meta.sources)) return false;

  // summary
  if (!summary || typeof summary !== 'object') return false;
  if (!summary.nifty50 || !isNullOrNumber(summary.nifty50.close) || !isNullOrNumber(summary.nifty50.change_pct)) return false;
  if (!summary.sensex || !isNullOrNumber(summary.sensex.close) || !isNullOrNumber(summary.sensex.change_pct)) return false;
  if (!summary.broader_market || !isNullOrNumber(summary.broader_market.smallcap_pct) || !isNullOrNumber(summary.broader_market.midcap_pct)) return false;
  if (!summary.breadth || !isNullOrNumber(summary.breadth.nifty500_advances) || !isNullOrNumber(summary.breadth.nifty500_declines)) return false;
  if (!summary.sectors || !isStringArray(summary.sectors.leaders) || !isStringArray(summary.sectors.laggards) || !isNullOrNumber(summary.sectors.count_advanced)) return false;
  if (!Array.isArray(summary.key_gainers) || !Array.isArray(summary.key_losers)) return false;
  if (!summary.institutional_flows || !isNullOrNumber(summary.institutional_flows.fii_net_cr) || !isNullOrNumber(summary.institutional_flows.dii_net_cr)) return false;
  if (!summary.macro || !isNullOrNumber(summary.macro.brent_crude) || !isNullOrNumber(summary.macro.india_10y_yield)) return false;
  if (summary.macro.usd_inr !== undefined && !isNullOrNumber(summary.macro.usd_inr)) return false;
  if (summary.macro.gold !== undefined && !isNullOrNumber(summary.macro.gold)) return false;
  if (summary.macro.india_vix !== undefined && !isNullOrNumber(summary.macro.india_vix)) return false;
  if (summary.macro.us_10y_yield !== undefined && !isNullOrNumber(summary.macro.us_10y_yield)) return false;
  if (summary.global_indices !== undefined) {
    if (!Array.isArray(summary.global_indices) || !summary.global_indices.every(validateNamedChange)) return false;
  }

  // triggers
  if (!triggers || !isStringArray(triggers.domestic) || !isStringArray(triggers.global)) return false;

  // deep_dive
  if (!deep_dive || !('full_text' in deep_dive) || !isNullOrString(deep_dive.full_text)) return false;
  if (deep_dive.summary_takeaway !== undefined) {
    if (!isNullOrString(deep_dive.summary_takeaway)) return false;
    if (isString(deep_dive.summary_takeaway) && deep_dive.summary_takeaway.length > 280) return false;
  }

  // outlook
  if (!outlook || typeof outlook !== 'object') return false;
  if (!Array.isArray(outlook.scenarios) || outlook.scenarios.length < 1 || outlook.scenarios.length > 5) return false;
  if (!outlook.scenarios.every(validateScenario)) return false;
  if (!Array.isArray(outlook.support_levels) || !Array.isArray(outlook.resistance_levels) || !Array.isArray(outlook.key_watch)) return false;

  // prediction_result
  if (!prediction_result || typeof prediction_result !== 'object') return false;
  if (!isNullOrNumber(prediction_result.actual_close)) return false;
  if (!isNullOrNumber(prediction_result.actual_change_pct)) return false;
  if (!isNullOrString(prediction_result.matched_scenario)) return false;
  if (!ACCURACY_TAGS.includes(prediction_result.accuracy_tag)) return false;
  if (!isNullOrString(prediction_result.verified_at)) return false;

  return true;
}

export function normalizeBriefing(obj) {
  const n = v => (v === undefined ? null : v);
  const nArr = v => (Array.isArray(v) ? v : []);

  const meta = obj.meta || {};
  const summary = obj.summary || {};
  const nifty50 = summary.nifty50 || {};
  const sensex = summary.sensex || {};
  const bm = summary.broader_market || {};
  const breadth = summary.breadth || {};
  const sectors = summary.sectors || {};
  const flows = summary.institutional_flows || {};
  const macro = summary.macro || {};
  const triggers = obj.triggers || {};
  const deep_dive = obj.deep_dive || {};
  const outlook = obj.outlook || {};
  const pr = obj.prediction_result || {};

  return {
    meta: {
      date: n(meta.date),
      session_status: n(meta.session_status),
      market_tone: n(meta.market_tone),
      sources: nArr(meta.sources),
    },
    summary: {
      nifty50: { close: n(nifty50.close), change_pct: n(nifty50.change_pct) },
      sensex: { close: n(sensex.close), change_pct: n(sensex.change_pct) },
      broader_market: { smallcap_pct: n(bm.smallcap_pct), midcap_pct: n(bm.midcap_pct) },
      breadth: { nifty500_advances: n(breadth.nifty500_advances), nifty500_declines: n(breadth.nifty500_declines) },
      sectors: { leaders: nArr(sectors.leaders), laggards: nArr(sectors.laggards), count_advanced: n(sectors.count_advanced) },
      key_gainers: nArr(summary.key_gainers),
      key_losers: nArr(summary.key_losers),
      institutional_flows: { fii_net_cr: n(flows.fii_net_cr), dii_net_cr: n(flows.dii_net_cr) },
      macro: {
        brent_crude: n(macro.brent_crude),
        india_10y_yield: n(macro.india_10y_yield),
        usd_inr: n(macro.usd_inr),
        gold: n(macro.gold),
        india_vix: n(macro.india_vix),
        us_10y_yield: n(macro.us_10y_yield),
      },
      global_indices: nArr(summary.global_indices).map(gi => ({ name: n(gi?.name), change_pct: n(gi?.change_pct) })),
    },
    triggers: {
      domestic: nArr(triggers.domestic),
      global: nArr(triggers.global),
    },
    deep_dive: { full_text: n(deep_dive.full_text), summary_takeaway: n(deep_dive.summary_takeaway) },
    outlook: {
      base_case: n(outlook.base_case),
      scenarios: nArr(outlook.scenarios),
      support_levels: nArr(outlook.support_levels),
      resistance_levels: nArr(outlook.resistance_levels),
      key_watch: nArr(outlook.key_watch),
    },
    prediction_result: {
      actual_close: n(pr.actual_close),
      actual_change_pct: n(pr.actual_change_pct),
      matched_scenario: n(pr.matched_scenario),
      accuracy_tag: n(pr.accuracy_tag),
      verified_at: n(pr.verified_at),
    },
    admin_notes: n(obj.admin_notes),
  };
}
