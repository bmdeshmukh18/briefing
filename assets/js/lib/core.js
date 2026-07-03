// Shared core logic for NSE Pulse — used by site and n8n function nodes

// ── Filename derivation ───────────────────────────────────────────
export function deriveBriefingPath(briefing) {
  return `/data/briefings/${briefing.meta.date}.json`;
}

// ── Index aggregation ─────────────────────────────────────────────
export function upsertIndexDate(index, date) {
  const dates = Array.isArray(index?.dates) ? [...index.dates] : [];
  if (dates.includes(date)) return { dates };
  const updated = [...dates, date].sort();
  return { dates: updated };
}

// ── History aggregation ───────────────────────────────────────────
export function upsertHistoryRow(history, row) {
  const series = Array.isArray(history?.series) ? history.series.filter(r => r.date !== row.date) : [];
  const updated = [...series, row].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return { series: updated };
}

// ── History row derivation (shared by admin console and n8n) ──────
export function buildHistoryRow(briefing) {
  const s = briefing?.summary ?? {};
  return {
    date: briefing?.meta?.date ?? null,
    nifty_close: s.nifty50?.close ?? null,
    nifty_change_pct: s.nifty50?.change_pct ?? null,
    fii_net_cr: s.institutional_flows?.fii_net_cr ?? null,
    dii_net_cr: s.institutional_flows?.dii_net_cr ?? null,
    advances: s.breadth?.nifty500_advances ?? null,
    declines: s.breadth?.nifty500_declines ?? null,
  };
}

// ── Briefing merge (fill-only-nulls; never touches prediction_result) ─
// Used when a Briefing_File already exists for a date (e.g. a later "backfill"
// email arrives with previously-unpublished FII/DII data). Any field already
// present in `existing` is kept as-is; only fields that are null/empty in
// `existing` get filled from `incoming`. This means a duplicate/repeat email
// never overwrites data that's already there — including `prediction_result`,
// which is written exclusively by the Prediction_Tracker workflow and must
// never be reset by a re-run of ingestion for an older date.
function isEmptyValue(v) {
  return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
}

function mergeScalar(existing, incoming) {
  return isEmptyValue(existing) && !isEmptyValue(incoming) ? incoming : existing;
}

function mergeField(existingObj, incomingObj, key) {
  return mergeScalar(existingObj?.[key], incomingObj?.[key]);
}

export function mergeBriefing(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const e = existing, i = incoming;
  return {
    meta: {
      date: e.meta?.date ?? i.meta?.date ?? null,
      session_status: e.meta?.session_status ?? i.meta?.session_status ?? null,
      market_tone: mergeField(e.meta, i.meta, 'market_tone'),
      sources: mergeScalar(e.meta?.sources, i.meta?.sources) ?? [],
    },
    summary: {
      nifty50: {
        close: mergeField(e.summary?.nifty50, i.summary?.nifty50, 'close'),
        change_pct: mergeField(e.summary?.nifty50, i.summary?.nifty50, 'change_pct'),
      },
      sensex: {
        close: mergeField(e.summary?.sensex, i.summary?.sensex, 'close'),
        change_pct: mergeField(e.summary?.sensex, i.summary?.sensex, 'change_pct'),
      },
      broader_market: {
        smallcap_pct: mergeField(e.summary?.broader_market, i.summary?.broader_market, 'smallcap_pct'),
        midcap_pct: mergeField(e.summary?.broader_market, i.summary?.broader_market, 'midcap_pct'),
      },
      breadth: {
        nifty500_advances: mergeField(e.summary?.breadth, i.summary?.breadth, 'nifty500_advances'),
        nifty500_declines: mergeField(e.summary?.breadth, i.summary?.breadth, 'nifty500_declines'),
      },
      sectors: {
        leaders: mergeScalar(e.summary?.sectors?.leaders, i.summary?.sectors?.leaders) ?? [],
        laggards: mergeScalar(e.summary?.sectors?.laggards, i.summary?.sectors?.laggards) ?? [],
        count_advanced: mergeField(e.summary?.sectors, i.summary?.sectors, 'count_advanced'),
      },
      key_gainers: mergeScalar(e.summary?.key_gainers, i.summary?.key_gainers) ?? [],
      key_losers: mergeScalar(e.summary?.key_losers, i.summary?.key_losers) ?? [],
      institutional_flows: {
        fii_net_cr: mergeField(e.summary?.institutional_flows, i.summary?.institutional_flows, 'fii_net_cr'),
        dii_net_cr: mergeField(e.summary?.institutional_flows, i.summary?.institutional_flows, 'dii_net_cr'),
      },
      macro: {
        brent_crude: mergeField(e.summary?.macro, i.summary?.macro, 'brent_crude'),
        india_10y_yield: mergeField(e.summary?.macro, i.summary?.macro, 'india_10y_yield'),
        usd_inr: mergeField(e.summary?.macro, i.summary?.macro, 'usd_inr'),
        gold: mergeField(e.summary?.macro, i.summary?.macro, 'gold'),
        india_vix: mergeField(e.summary?.macro, i.summary?.macro, 'india_vix'),
        us_10y_yield: mergeField(e.summary?.macro, i.summary?.macro, 'us_10y_yield'),
      },
      global_indices: mergeScalar(e.summary?.global_indices, i.summary?.global_indices) ?? [],
    },
    triggers: {
      domestic: mergeScalar(e.triggers?.domestic, i.triggers?.domestic) ?? [],
      global: mergeScalar(e.triggers?.global, i.triggers?.global) ?? [],
    },
    deep_dive: {
      full_text: mergeField(e.deep_dive, i.deep_dive, 'full_text'),
      summary_takeaway: mergeField(e.deep_dive, i.deep_dive, 'summary_takeaway'),
    },
    outlook: {
      base_case: mergeField(e.outlook, i.outlook, 'base_case'),
      scenarios: mergeScalar(e.outlook?.scenarios, i.outlook?.scenarios) ?? [],
      support_levels: mergeScalar(e.outlook?.support_levels, i.outlook?.support_levels) ?? [],
      resistance_levels: mergeScalar(e.outlook?.resistance_levels, i.outlook?.resistance_levels) ?? [],
      key_watch: mergeScalar(e.outlook?.key_watch, i.outlook?.key_watch) ?? [],
    },
    // Owned exclusively by the Prediction_Tracker workflow — never touched here.
    prediction_result: e.prediction_result,
    admin_notes: e.admin_notes ?? i.admin_notes ?? null,
  };
}

// ── Date access helpers ───────────────────────────────────────────
export function getLatestDate(index) {
  if (!index?.dates?.length) return null;
  return [...index.dates].sort().at(-1);
}

export function isDateAccessible(dateStr, index) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return Array.isArray(index?.dates) && index.dates.includes(dateStr);
}

export function navigatorDates(index) {
  if (!index?.dates?.length) return [];
  return [...index.dates].sort().reverse();
}

// ── Chart windowing ───────────────────────────────────────────────
export function windowSeries(series, n = 30) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const sorted = [...series].sort((a, b) => a.date < b.date ? -1 : 1);
  return sorted.slice(-n);
}

export function plottablePoints(series, metric) {
  return series.map(row => ({
    x: row.date,
    y: row[metric] !== null && row[metric] !== undefined ? row[metric] : null,
  }));
}

// ── Accuracy classification ───────────────────────────────────────
export function classifyAccuracy(actualClose, scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    return { accuracy_tag: 'Wrong', matched_scenario: null };
  }

  const inRange = s => actualClose >= s.range_low && actualClose <= s.range_high;

  // Find highest-probability scenario (first in list on tie)
  const top = scenarios.reduce((best, s) => s.probability > best.probability ? s : best, scenarios[0]);

  if (inRange(top)) {
    return { accuracy_tag: 'Correct', matched_scenario: top.name };
  }

  const matching = scenarios.filter(inRange);
  if (matching.length > 0) {
    const best = matching.reduce((b, s) => s.probability > b.probability ? s : b, matching[0]);
    return { accuracy_tag: 'Partial', matched_scenario: best.name };
  }

  return { accuracy_tag: 'Wrong', matched_scenario: null };
}

// ── Trading day gate ──────────────────────────────────────────────
export function shouldSkipVerification(date, holidayList = []) {
  const d = new Date(date + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return { skip: true, reason: 'weekend' };
  if (holidayList.includes(date)) return { skip: true, reason: 'holiday' };
  return { skip: false, reason: null };
}

// ── Rolling accuracy ──────────────────────────────────────────────
export function rollingAccuracy(taggedSequence) {
  // taggedSequence: array of { date, accuracy_tag } sorted ascending
  // Consider only entries with non-null accuracy_tag, most recent 30
  const tagged = taggedSequence
    .filter(d => d.accuracy_tag !== null && d.accuracy_tag !== undefined)
    .slice(-30);

  if (tagged.length === 0) return { state: 'no_predictions', value: null };

  const correct = tagged.filter(d => d.accuracy_tag === 'Correct').length;
  if (correct === 0) return { state: 'no_correct', value: null };

  const pct = Math.round((correct / tagged.length) * 1000) / 10;
  return { state: 'percentage', value: pct };
}

// ── SEO construction ──────────────────────────────────────────────
export function buildSeo(briefing) {
  const date = briefing?.meta?.date ?? null;
  const tone = briefing?.meta?.market_tone ?? null;

  let title = 'NSE Pulse';
  if (date && tone) title = `NSE Pulse — ${date} | ${tone}`;
  else if (date) title = `NSE Pulse — ${date}`;
  else if (tone) title = `NSE Pulse | ${tone}`;

  let desc = 'NSE market briefing';
  if (date && tone) desc = `Market briefing for ${date}: ${tone}`;
  else if (date) desc = `NSE market briefing for ${date}`;
  else if (tone) desc = `NSE market briefing: ${tone}`;

  return {
    title,
    description: desc.slice(0, 160),
  };
}

// ── Access control ────────────────────────────────────────────────
export function isGated(item, latestDate) {
  if (item.type === 'chart') return true;
  if (item.type === 'deep_dive') return true;
  if (item.type === 'briefing' && item.date !== latestDate) return true;
  return false;
}

export function accessDecision(item, config, authenticated) {
  if (!config.accessControlEnabled) return { granted: true };
  if (!isGated(item, config.latestDate)) return { granted: true };
  if (authenticated) return { granted: true };
  return { granted: false, prompt: 'auth' };
}

// ── Admin notes ───────────────────────────────────────────────────
export function adminNotesDecision(briefing, adminViewEnabled) {
  const notes = briefing?.admin_notes ?? null;
  if (notes !== null && notes.length > 5000) {
    console.warn('admin_notes exceeds 5000 chars');
  }
  if (!adminViewEnabled) return { show: false, notes: null };
  if (!notes) return { show: false, notes: null };
  return { show: true, notes };
}
