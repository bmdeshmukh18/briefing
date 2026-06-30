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
