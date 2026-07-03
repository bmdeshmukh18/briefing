// Feature: nse-pulse — Core logic property-based tests
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  deriveBriefingPath, upsertIndexDate, upsertHistoryRow,
  getLatestDate, isDateAccessible, navigatorDates,
  windowSeries, plottablePoints,
  classifyAccuracy, shouldSkipVerification, rollingAccuracy,
  buildSeo, isGated, accessDecision, adminNotesDecision,
  buildHistoryRow, mergeBriefing,
} from '../assets/js/lib/core.js';

const genISODate = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map(d => d.toISOString().slice(0, 10));

const genHistoryRow = fc.record({
  date: genISODate,
  nifty_close: fc.oneof(fc.constant(null), fc.float({ min: 10000, max: 30000, noNaN: true })),
  nifty_change_pct: fc.oneof(fc.constant(null), fc.float({ min: -10, max: 10, noNaN: true })),
  fii_net_cr: fc.oneof(fc.constant(null), fc.float({ min: -5000, max: 5000, noNaN: true })),
  dii_net_cr: fc.oneof(fc.constant(null), fc.float({ min: -5000, max: 5000, noNaN: true })),
  advances: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 500 })),
  declines: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 500 })),
});

// ── Property 4: Briefing filename derives from meta.date ──────────
describe('Property 4: Briefing filename derives from meta.date', () => {
  it('returns /data/briefings/{date}.json', () => {
    // Feature: nse-pulse, Property 4: Briefing filename derives from meta.date
    fc.assert(fc.property(genISODate, (date) => {
      const path = deriveBriefingPath({ meta: { date } });
      expect(path).toBe(`/data/briefings/${date}.json`);
    }), { numRuns: 100 });
  });
});

// ── Property 5: Index file is complete, ascending, dedupe, idempotent ─
describe('Property 5: Index file ascending, duplicate-free, idempotent', () => {
  it('inserting dates produces a sorted deduplicated list', () => {
    // Feature: nse-pulse, Property 5: Index file is complete, ascending, duplicate-free, and idempotent
    fc.assert(fc.property(fc.array(genISODate, { minLength: 1, maxLength: 20 }), (dates) => {
      let index = {};
      for (const d of dates) {
        index = upsertIndexDate(index, d);
      }
      const result = index.dates;
      // Ascending
      for (let i = 1; i < result.length; i++) {
        expect(result[i] >= result[i - 1]).toBe(true);
      }
      // No duplicates
      expect(new Set(result).size).toBe(result.length);
      // Contains all unique input dates
      const unique = [...new Set(dates)];
      for (const d of unique) expect(result).toContain(d);
    }), { numRuns: 100 });
  });

  it('is idempotent: inserting existing date changes nothing', () => {
    // Feature: nse-pulse, Property 5: idempotent
    fc.assert(fc.property(fc.array(genISODate, { minLength: 1, maxLength: 10 }), genISODate, (dates, extra) => {
      let index = {};
      for (const d of [...dates, extra]) index = upsertIndexDate(index, d);
      const before = [...index.dates];
      index = upsertIndexDate(index, extra);
      expect(index.dates).toEqual(before);
    }), { numRuns: 100 });
  });
});

// ── Property 6: History file ascending and replace-not-append ─────
describe('Property 6: History file ascending, replace-not-append idempotent', () => {
  it('series is ascending by date and contains no duplicate dates', () => {
    // Feature: nse-pulse, Property 6: History file is ascending and replace-not-append idempotent
    fc.assert(fc.property(fc.array(genHistoryRow, { minLength: 1, maxLength: 20 }), (rows) => {
      let history = {};
      for (const row of rows) history = upsertHistoryRow(history, row);
      const series = history.series;
      for (let i = 1; i < series.length; i++) {
        expect(series[i].date >= series[i - 1].date).toBe(true);
      }
      const dates = series.map(r => r.date);
      expect(new Set(dates).size).toBe(dates.length);
    }), { numRuns: 100 });
  });

  it('re-inserting same date replaces row, not appends', () => {
    // Feature: nse-pulse, Property 6: replace-not-append
    fc.assert(fc.property(genHistoryRow, genHistoryRow, (rowA, rowB) => {
      const row1 = { ...rowA, date: '2026-06-01' };
      const row2 = { ...rowB, date: '2026-06-01' };
      let history = upsertHistoryRow({}, row1);
      history = upsertHistoryRow(history, row2);
      expect(history.series.filter(r => r.date === '2026-06-01').length).toBe(1);
      expect(history.series.find(r => r.date === '2026-06-01').nifty_close).toBe(row2.nifty_close);
    }), { numRuns: 100 });
  });
});

// ── Property 7: Latest-date default selection ─────────────────────
describe('Property 7: Latest-date default selection', () => {
  it('returns the maximum date from a non-empty index', () => {
    // Feature: nse-pulse, Property 7: Latest-date default selection
    fc.assert(fc.property(fc.array(genISODate, { minLength: 1, maxLength: 20 }), (dates) => {
      const index = { dates: [...new Set(dates)].sort() };
      const latest = getLatestDate(index);
      const expected = [...dates].sort().at(-1);
      expect(latest).toBe(expected);
    }), { numRuns: 100 });
  });

  it('returns null for empty index', () => {
    expect(getLatestDate({ dates: [] })).toBeNull();
    expect(getLatestDate({})).toBeNull();
  });
});

// ── Property 8: Date-navigator descending order ───────────────────
describe('Property 8: Date-navigator descending order', () => {
  it('returns index dates most-recent-first', () => {
    // Feature: nse-pulse, Property 8: Date-navigator descending order
    fc.assert(fc.property(fc.array(genISODate, { minLength: 1, maxLength: 20 }), (dates) => {
      const unique = [...new Set(dates)].sort();
      const index = { dates: unique };
      const result = navigatorDates(index);
      for (let i = 1; i < result.length; i++) {
        expect(result[i] <= result[i - 1]).toBe(true);
      }
      expect(result).toEqual([...unique].reverse());
    }), { numRuns: 100 });
  });
});

// ── Property 9: Date-access gate ─────────────────────────────────
describe('Property 9: Date-access gate', () => {
  it('grants access iff date is valid ISO-8601 and present in index', () => {
    // Feature: nse-pulse, Property 9: Date-access gate
    fc.assert(fc.property(
      fc.array(genISODate, { minLength: 1, maxLength: 10 }),
      genISODate,
    (indexDates, queryDate) => {
      const unique = [...new Set(indexDates)];
      const index = { dates: unique };
      const inIndex = unique.includes(queryDate);
      expect(isDateAccessible(queryDate, index)).toBe(inIndex);
    }), { numRuns: 100 });
  });

  it('rejects malformed date strings', () => {
    const index = { dates: ['2026-06-22'] };
    expect(isDateAccessible('not-a-date', index)).toBe(false);
    expect(isDateAccessible('', index)).toBe(false);
    expect(isDateAccessible(null, index)).toBe(false);
    expect(isDateAccessible('2026-13-01', index)).toBe(false);
  });
});

// ── Property 14: Chart window is min(30, n) most recent days ──────
describe('Property 14: Chart window size', () => {
  it('returns min(30, n) most recent rows in ascending order', () => {
    // Feature: nse-pulse, Property 14: Chart window is the most recent min(30, n) days
    fc.assert(fc.property(fc.array(genHistoryRow, { maxLength: 50 }), (rows) => {
      const unique = Object.values(
        rows.reduce((acc, r) => { acc[r.date] = r; return acc; }, {})
      );
      const result = windowSeries(unique, 30);
      expect(result.length).toBe(Math.min(30, unique.length));
      for (let i = 1; i < result.length; i++) {
        expect(result[i].date >= result[i - 1].date).toBe(true);
      }
    }), { numRuns: 100 });
  });
});

// ── Property 15: Null chart points are omitted without substitution ─
describe('Property 15: Null chart points are omitted without substitution', () => {
  it('maps null metric values to null y, preserving order', () => {
    // Feature: nse-pulse, Property 15: Null chart points are omitted without substitution
    fc.assert(fc.property(fc.array(genHistoryRow, { minLength: 1, maxLength: 30 }), (rows) => {
      const result = plottablePoints(rows, 'nifty_close');
      expect(result.length).toBe(rows.length);
      rows.forEach((row, i) => {
        if (row.nifty_close === null) {
          expect(result[i].y).toBeNull();
        } else {
          expect(result[i].y).toBe(row.nifty_close);
          expect(result[i].y).not.toBe(0);
        }
      });
    }), { numRuns: 100 });
  });
});

// ── Property 16: Accuracy classification correctness ─────────────
describe('Property 16: Accuracy classification correctness', () => {
  const genScenarios = fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      probability: fc.integer({ min: 0, max: 100 }),
      range_low: fc.float({ min: 20000, max: 25000, noNaN: true }),
      range_high: fc.float({ min: 20000, max: 25000, noNaN: true }),
    }).map(s => ({ ...s, range_low: Math.min(s.range_low, s.range_high), range_high: Math.max(s.range_low, s.range_high) })),
    { minLength: 1, maxLength: 5 }
  );

  it('classifies Correct when close is in highest-prob scenario range', () => {
    // Feature: nse-pulse, Property 16: Accuracy classification correctness
    fc.assert(fc.property(genScenarios, (scenarios) => {
      const top = scenarios.reduce((b, s) => s.probability > b.probability ? s : b, scenarios[0]);
      const close = (top.range_low + top.range_high) / 2;
      const result = classifyAccuracy(close, scenarios);
      expect(result.accuracy_tag).toBe('Correct');
      expect(result.matched_scenario).toBe(top.name);
    }), { numRuns: 100 });
  });

  it('classifies Wrong when close is outside all ranges', () => {
    fc.assert(fc.property(genScenarios, (scenarios) => {
      const maxHigh = Math.max(...scenarios.map(s => s.range_high));
      const close = maxHigh + 10000;
      const result = classifyAccuracy(close, scenarios);
      expect(result.accuracy_tag).toBe('Wrong');
      expect(result.matched_scenario).toBeNull();
    }), { numRuns: 100 });
  });
});

// ── Property 17: Rolling accuracy computation and display state ───
describe('Property 17: Rolling accuracy computation and display state', () => {
  const genTagSeq = fc.array(
    fc.record({
      date: genISODate,
      accuracy_tag: fc.oneof(
        fc.constant(null),
        fc.constantFrom('Correct', 'Partial', 'Wrong')
      ),
    }),
    { maxLength: 40 }
  );

  it('returns no_predictions when no tagged days', () => {
    // Feature: nse-pulse, Property 17: Rolling accuracy computation and display state
    const result = rollingAccuracy([]);
    expect(result.state).toBe('no_predictions');
  });

  it('returns no_correct when all tagged are non-Correct', () => {
    const seq = [
      { date: '2026-06-01', accuracy_tag: 'Wrong' },
      { date: '2026-06-02', accuracy_tag: 'Partial' },
    ];
    const result = rollingAccuracy(seq);
    expect(result.state).toBe('no_correct');
  });

  it('returns percentage correctly for Correct entries', () => {
    const seq = [
      { date: '2026-06-01', accuracy_tag: 'Correct' },
      { date: '2026-06-02', accuracy_tag: 'Wrong' },
      { date: '2026-06-03', accuracy_tag: 'Correct' },
    ];
    const result = rollingAccuracy(seq);
    expect(result.state).toBe('percentage');
    expect(result.value).toBeCloseTo(66.7, 1);
  });

  it('considers only most recent 30 tagged entries', () => {
    // Feature: nse-pulse, Property 17: >30-window case
    fc.assert(fc.property(genTagSeq, (seq) => {
      const result = rollingAccuracy(seq);
      expect(['no_predictions', 'no_correct', 'percentage']).toContain(result.state);
      if (result.state === 'percentage') {
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(100);
      }
    }), { numRuns: 100 });
  });
});

// ── Property: History row derivation ──────────────────────────────
describe('Property: History row derivation', () => {
  const genBriefingForRow = fc.record({
    meta: fc.record({ date: fc.oneof(genISODate, fc.constant(null)) }),
    summary: fc.record({
      nifty50: fc.record({ close: fc.oneof(fc.constant(null), fc.float({ min: 10000, max: 30000, noNaN: true })), change_pct: fc.oneof(fc.constant(null), fc.float({ min: -10, max: 10, noNaN: true })) }),
      institutional_flows: fc.record({ fii_net_cr: fc.oneof(fc.constant(null), fc.float({ min: -5000, max: 5000, noNaN: true })), dii_net_cr: fc.oneof(fc.constant(null), fc.float({ min: -5000, max: 5000, noNaN: true })) }),
      breadth: fc.record({ nifty500_advances: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 500 })), nifty500_declines: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 500 })) }),
    }),
  });

  it('maps summary.* fields to the flat history row shape, defaulting absent values to null', () => {
    // Feature: nse-pulse, Property: History row derivation
    fc.assert(fc.property(genBriefingForRow, (briefing) => {
      const row = buildHistoryRow(briefing);
      expect(row.date).toBe(briefing.meta.date ?? null);
      expect(row.nifty_close).toBe(briefing.summary.nifty50.close ?? null);
      expect(row.nifty_change_pct).toBe(briefing.summary.nifty50.change_pct ?? null);
      expect(row.fii_net_cr).toBe(briefing.summary.institutional_flows.fii_net_cr ?? null);
      expect(row.dii_net_cr).toBe(briefing.summary.institutional_flows.dii_net_cr ?? null);
      expect(row.advances).toBe(briefing.summary.breadth.nifty500_advances ?? null);
      expect(row.declines).toBe(briefing.summary.breadth.nifty500_declines ?? null);
    }), { numRuns: 100 });
  });

  it('handles a briefing with entirely missing summary gracefully', () => {
    const row = buildHistoryRow({ meta: { date: '2026-07-03' } });
    expect(row).toEqual({
      date: '2026-07-03', nifty_close: null, nifty_change_pct: null,
      fii_net_cr: null, dii_net_cr: null, advances: null, declines: null,
    });
  });
});

// ── mergeBriefing: fill-only-nulls, never touches prediction_result ────
describe('mergeBriefing', () => {
  function makeBriefing(overrides = {}) {
    const base = {
      meta: { date: '2026-07-03', session_status: 'Trading', market_tone: null, sources: [] },
      summary: {
        nifty50: { close: 24000, change_pct: 0.5 },
        sensex: { close: 78000, change_pct: 0.4 },
        broader_market: { smallcap_pct: null, midcap_pct: null },
        breadth: { nifty500_advances: null, nifty500_declines: null },
        sectors: { leaders: [], laggards: [], count_advanced: null },
        key_gainers: [], key_losers: [],
        institutional_flows: { fii_net_cr: null, dii_net_cr: null },
        macro: { brent_crude: null, india_10y_yield: null, usd_inr: null, gold: null, india_vix: null, us_10y_yield: null },
        global_indices: [],
      },
      triggers: { domestic: [], global: [] },
      deep_dive: { full_text: null, summary_takeaway: null },
      outlook: { base_case: null, scenarios: [{ name: 'A', probability: 100, range_low: 1, range_high: 2 }], support_levels: [], resistance_levels: [], key_watch: [] },
      prediction_result: { actual_close: null, actual_change_pct: null, matched_scenario: null, accuracy_tag: null, verified_at: null },
      admin_notes: null,
    };
    return { ...base, ...overrides };
  }

  it('returns incoming unchanged when no existing briefing', () => {
    const incoming = makeBriefing();
    expect(mergeBriefing(null, incoming)).toBe(incoming);
  });

  it('returns existing unchanged when no incoming briefing', () => {
    const existing = makeBriefing();
    expect(mergeBriefing(existing, null)).toBe(existing);
  });

  it('fills a previously-null scalar field (e.g. FII/DII) from incoming', () => {
    const existing = makeBriefing();
    const incoming = makeBriefing({
      summary: { ...existing.summary, institutional_flows: { fii_net_cr: -500, dii_net_cr: 800 } },
    });
    const merged = mergeBriefing(existing, incoming);
    expect(merged.summary.institutional_flows).toEqual({ fii_net_cr: -500, dii_net_cr: 800 });
  });

  it('never overwrites an existing non-null scalar field with a different incoming value', () => {
    const existing = makeBriefing();
    const incoming = makeBriefing({
      summary: { ...existing.summary, nifty50: { close: 99999, change_pct: 9.9 } },
    });
    const merged = mergeBriefing(existing, incoming);
    expect(merged.summary.nifty50).toEqual({ close: 24000, change_pct: 0.5 });
  });

  it('fills a previously-empty array field from incoming', () => {
    const existing = makeBriefing();
    const incoming = makeBriefing({
      summary: { ...existing.summary, key_gainers: [{ symbol: 'INFY', change_pct: 2 }] },
    });
    const merged = mergeBriefing(existing, incoming);
    expect(merged.summary.key_gainers).toEqual([{ symbol: 'INFY', change_pct: 2 }]);
  });

  it('keeps an existing non-empty array field even if incoming has a different one', () => {
    const existing = makeBriefing({
      summary: { ...makeBriefing().summary, key_gainers: [{ symbol: 'TCS', change_pct: 1 }] },
    });
    const incoming = makeBriefing({
      summary: { ...makeBriefing().summary, key_gainers: [{ symbol: 'INFY', change_pct: 2 }] },
    });
    const merged = mergeBriefing(existing, incoming);
    expect(merged.summary.key_gainers).toEqual([{ symbol: 'TCS', change_pct: 1 }]);
  });

  it('always keeps existing prediction_result, regardless of what incoming contains', () => {
    // Feature: nse-pulse, Property: prediction_result is owned exclusively by Prediction_Tracker
    fc.assert(fc.property(
      fc.oneof(fc.constant(null), fc.constantFrom('Correct', 'Partial', 'Wrong')),
      fc.oneof(fc.constant(null), fc.constantFrom('Correct', 'Partial', 'Wrong')),
      (existingTag, incomingTag) => {
        const existing = makeBriefing({ prediction_result: { actual_close: 100, actual_change_pct: 1, matched_scenario: 'A', accuracy_tag: existingTag, verified_at: '2026-07-02T00:00:00Z' } });
        const incoming = makeBriefing({ prediction_result: { actual_close: 200, actual_change_pct: 2, matched_scenario: 'B', accuracy_tag: incomingTag, verified_at: null } });
        const merged = mergeBriefing(existing, incoming);
        expect(merged.prediction_result).toEqual(existing.prediction_result);
      }
    ), { numRuns: 100 });
  });
});

// ── Unit: shouldSkipVerification ──────────────────────────────────
describe('shouldSkipVerification', () => {
  it('skips weekends', () => {
    expect(shouldSkipVerification('2026-06-28').skip).toBe(true); // Sunday
    expect(shouldSkipVerification('2026-06-27').skip).toBe(true); // Saturday
  });
  it('does not skip weekdays', () => {
    expect(shouldSkipVerification('2026-06-22').skip).toBe(false); // Monday
  });
  it('skips configured holidays', () => {
    expect(shouldSkipVerification('2026-08-15', ['2026-08-15']).skip).toBe(true);
  });
});

// ── Unit: buildSeo ────────────────────────────────────────────────
describe('buildSeo', () => {
  it('builds title and description under 160 chars', () => {
    const result = buildSeo({ meta: { date: '2026-06-22', market_tone: 'Cautiously bullish' } });
    expect(result.title).toContain('2026-06-22');
    expect(result.description.length).toBeLessThanOrEqual(160);
  });
  it('handles null date and tone gracefully', () => {
    const result = buildSeo({ meta: { date: null, market_tone: null } });
    expect(result.title).toBeTruthy();
    expect(result.description).toBeTruthy();
  });
});

// ── Unit: adminNotesDecision ──────────────────────────────────────
describe('adminNotesDecision', () => {
  it('hides notes when adminViewEnabled is false', () => {
    const result = adminNotesDecision({ admin_notes: 'private' }, false);
    expect(result.show).toBe(false);
    expect(result.notes).toBeNull();
  });
  it('shows notes when enabled and non-empty', () => {
    const result = adminNotesDecision({ admin_notes: 'private' }, true);
    expect(result.show).toBe(true);
    expect(result.notes).toBe('private');
  });
  it('does not show null notes even when enabled', () => {
    const result = adminNotesDecision({ admin_notes: null }, true);
    expect(result.show).toBe(false);
  });
});
