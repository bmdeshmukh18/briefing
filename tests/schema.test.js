// Feature: nse-pulse — Schema property-based tests
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateBriefing, normalizeBriefing } from '../assets/js/lib/schema.js';

// ── Arbitraries ───────────────────────────────────────────────────
const genScenario = fc.record({
  name: fc.string({ minLength: 1, maxLength: 60 }),
  probability: fc.integer({ min: 0, max: 100 }),
  range_low: fc.float({ min: 10000, max: 30000, noNaN: true }),
  range_high: fc.float({ min: 10000, max: 30000, noNaN: true }),
}).map(s => ({
  ...s,
  range_low: Math.min(s.range_low, s.range_high),
  range_high: Math.max(s.range_low, s.range_high),
}));

const genDate = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map(d => d.toISOString().slice(0, 10));

const genNullOrNum = fc.oneof(fc.constant(null), fc.float({ min: -10000, max: 100000, noNaN: true }));
const genNullOrStr = fc.oneof(fc.constant(null), fc.string({ maxLength: 60 }));
const genStrArr = fc.array(fc.string({ maxLength: 80 }), { maxLength: 10 });

const genNamedChangeArr = fc.array(
  fc.record({ name: fc.string({ minLength: 1, maxLength: 40 }), change_pct: genNullOrNum }),
  { maxLength: 8 }
);

const genBriefing = fc.record({
  meta: fc.record({
    date: genDate,
    session_status: fc.constantFrom('Trading', 'Holiday'),
    market_tone: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 60 })),
    sources: genStrArr,
  }),
  summary: fc.record({
    nifty50: fc.record({ close: genNullOrNum, change_pct: genNullOrNum }),
    sensex: fc.record({ close: genNullOrNum, change_pct: genNullOrNum }),
    broader_market: fc.record({ smallcap_pct: genNullOrNum, midcap_pct: genNullOrNum }),
    breadth: fc.record({ nifty500_advances: genNullOrNum, nifty500_declines: genNullOrNum }),
    sectors: fc.record({
      leaders: genStrArr,
      laggards: genStrArr,
      count_advanced: genNullOrNum,
    }),
    key_gainers: fc.array(fc.record({ symbol: fc.string({ minLength: 1, maxLength: 20 }), change_pct: genNullOrNum }), { maxLength: 10 }),
    key_losers: fc.array(fc.record({ symbol: fc.string({ minLength: 1, maxLength: 20 }), change_pct: genNullOrNum }), { maxLength: 10 }),
    institutional_flows: fc.record({ fii_net_cr: genNullOrNum, dii_net_cr: genNullOrNum }),
    macro: fc.record({
      brent_crude: genNullOrNum,
      india_10y_yield: genNullOrNum,
      usd_inr: genNullOrNum,
      gold: genNullOrNum,
      india_vix: genNullOrNum,
      us_10y_yield: genNullOrNum,
    }),
    global_indices: genNamedChangeArr,
  }),
  triggers: fc.record({ domestic: genStrArr, global: genStrArr }),
  deep_dive: fc.record({
    full_text: fc.oneof(fc.constant(null), fc.string({ maxLength: 5000 })),
    summary_takeaway: fc.oneof(fc.constant(null), fc.string({ maxLength: 280 })),
  }),
  outlook: fc.record({
    base_case: genNullOrStr,
    scenarios: fc.array(genScenario, { minLength: 1, maxLength: 5 }),
    support_levels: fc.array(fc.float({ min: 10000, max: 40000, noNaN: true }), { maxLength: 10 }),
    resistance_levels: fc.array(fc.float({ min: 10000, max: 40000, noNaN: true }), { maxLength: 10 }),
    key_watch: genStrArr,
  }),
  prediction_result: fc.record({
    actual_close: genNullOrNum,
    actual_change_pct: genNullOrNum,
    matched_scenario: fc.oneof(fc.constant(null), fc.string({ maxLength: 60 })),
    accuracy_tag: fc.oneof(fc.constant(null), fc.constantFrom('Correct', 'Partial', 'Wrong')),
    verified_at: fc.oneof(fc.constant(null), fc.string({ maxLength: 30 })),
  }),
  admin_notes: fc.oneof(fc.constant(null), fc.string({ maxLength: 5000 })),
});

// ── Property 1: Schema conformance and null-preservation round-trip ──
describe('Property 1: Schema conformance and null-preservation round-trip', () => {
  it('normalizeBriefing preserves all top-level keys and replaces undefined with null', () => {
    // Feature: nse-pulse, Property 1: Schema conformance and null-preservation round-trip
    fc.assert(fc.property(genBriefing, (briefing) => {
      const normalized = normalizeBriefing(briefing);
      const requiredKeys = ['meta', 'summary', 'triggers', 'deep_dive', 'outlook', 'prediction_result', 'admin_notes'];
      for (const key of requiredKeys) {
        expect(normalized).toHaveProperty(key);
      }
      // meta fields
      expect(normalized.meta).toHaveProperty('date');
      expect(normalized.meta).toHaveProperty('session_status');
      expect(normalized.meta).toHaveProperty('market_tone');
      // prediction_result fields
      const prKeys = ['actual_close', 'actual_change_pct', 'matched_scenario', 'accuracy_tag', 'verified_at'];
      for (const k of prKeys) expect(normalized.prediction_result).toHaveProperty(k);
    }), { numRuns: 100 });
  });
});

// ── Property 2: Outlook scenario invariants ───────────────────────
describe('Property 2: Outlook scenario invariants', () => {
  it('scenarios have 1-5 items, probability 0-100, range_low <= range_high', () => {
    // Feature: nse-pulse, Property 2: Outlook scenario invariants
    fc.assert(fc.property(genBriefing, (briefing) => {
      const { scenarios } = briefing.outlook;
      expect(scenarios.length).toBeGreaterThanOrEqual(1);
      expect(scenarios.length).toBeLessThanOrEqual(5);
      for (const s of scenarios) {
        expect(s.probability).toBeGreaterThanOrEqual(0);
        expect(s.probability).toBeLessThanOrEqual(100);
        expect(s.range_low).toBeLessThanOrEqual(s.range_high);
        expect(s.name.length).toBeLessThanOrEqual(60);
      }
    }), { numRuns: 100 });
  });
});

// ── Property 3: Schema validation accepts valid and rejects invalid ─
describe('Property 3: Schema validation accepts valid and rejects invalid', () => {
  it('validates correctly formed briefings as valid', () => {
    // Feature: nse-pulse, Property 3: Schema validation accepts valid and rejects invalid
    fc.assert(fc.property(genBriefing, (briefing) => {
      expect(validateBriefing(briefing)).toBe(true);
    }), { numRuns: 100 });
  });

  it('rejects briefings with null meta.date', () => {
    fc.assert(fc.property(genBriefing, (briefing) => {
      const bad = { ...briefing, meta: { ...briefing.meta, date: null } };
      expect(validateBriefing(bad)).toBe(false);
    }), { numRuns: 100 });
  });

  it('rejects briefings with invalid session_status', () => {
    fc.assert(fc.property(genBriefing, (briefing) => {
      const bad = { ...briefing, meta: { ...briefing.meta, session_status: 'INVALID' } };
      expect(validateBriefing(bad)).toBe(false);
    }), { numRuns: 100 });
  });

  it('rejects briefings with out-of-range probability', () => {
    fc.assert(fc.property(genBriefing, (briefing) => {
      const badScenario = { ...briefing.outlook.scenarios[0], probability: 150 };
      const bad = { ...briefing, outlook: { ...briefing.outlook, scenarios: [badScenario] } };
      expect(validateBriefing(bad)).toBe(false);
    }), { numRuns: 100 });
  });

  it('rejects briefings with range_low > range_high', () => {
    fc.assert(fc.property(genBriefing, fc.float({ min: 1, max: 100, noNaN: true }), (briefing, diff) => {
      const s0 = briefing.outlook.scenarios[0];
      const badScenario = { ...s0, range_low: s0.range_high + diff, range_high: s0.range_high };
      const bad = { ...briefing, outlook: { ...briefing.outlook, scenarios: [badScenario] } };
      expect(validateBriefing(bad)).toBe(false);
    }), { numRuns: 100 });
  });

  it('rejects briefings with missing top-level key', () => {
    fc.assert(fc.property(genBriefing, (briefing) => {
      const bad = { ...briefing };
      delete bad.triggers;
      expect(validateBriefing(bad)).toBe(false);
    }), { numRuns: 100 });
  });
});

// ── Property: Schema v2 backward compatibility ────────────────────
describe('Property: Schema v2 backward compatibility', () => {
  it('validates and normalizes v1-only briefings (v2 keys entirely absent)', () => {
    fc.assert(fc.property(genBriefing, (briefing) => {
      const v1 = JSON.parse(JSON.stringify(briefing));
      delete v1.meta.sources;
      delete v1.summary.global_indices;
      delete v1.summary.macro.usd_inr;
      delete v1.summary.macro.gold;
      delete v1.summary.macro.india_vix;
      delete v1.summary.macro.us_10y_yield;
      delete v1.deep_dive.summary_takeaway;

      expect(validateBriefing(v1)).toBe(true);

      const normalized = normalizeBriefing(v1);
      expect(normalized.meta.sources).toEqual([]);
      expect(normalized.summary.global_indices).toEqual([]);
      expect(normalized.summary.macro.usd_inr).toBeNull();
      expect(normalized.summary.macro.gold).toBeNull();
      expect(normalized.summary.macro.india_vix).toBeNull();
      expect(normalized.summary.macro.us_10y_yield).toBeNull();
      expect(normalized.deep_dive.summary_takeaway).toBeNull();
    }), { numRuns: 100 });
  });
});

// ── Unit: v2 field validation ──────────────────────────────────────
describe('Unit: schema v2 field validation', () => {
  const baseV1 = {
    meta: { date: '2026-06-22', session_status: 'Trading', market_tone: null },
    summary: {
      nifty50: { close: 100, change_pct: 1 },
      sensex: { close: 100, change_pct: 1 },
      broader_market: { smallcap_pct: 1, midcap_pct: 1 },
      breadth: { nifty500_advances: 1, nifty500_declines: 1 },
      sectors: { leaders: [], laggards: [], count_advanced: 1 },
      key_gainers: [],
      key_losers: [],
      institutional_flows: { fii_net_cr: 1, dii_net_cr: 1 },
      macro: { brent_crude: 1, india_10y_yield: 1 },
    },
    triggers: { domestic: [], global: [] },
    deep_dive: { full_text: null },
    outlook: {
      base_case: null,
      scenarios: [{ name: 'A', probability: 50, range_low: 1, range_high: 2 }],
      support_levels: [], resistance_levels: [], key_watch: [],
    },
    prediction_result: { actual_close: null, actual_change_pct: null, matched_scenario: null, accuracy_tag: null, verified_at: null },
    admin_notes: null,
  };

  it('accepts v1 fixture with no v2 keys at all', () => {
    expect(validateBriefing(baseV1)).toBe(true);
  });

  it('rejects summary_takeaway longer than 280 chars', () => {
    const bad = { ...baseV1, deep_dive: { ...baseV1.deep_dive, summary_takeaway: 'x'.repeat(281) } };
    expect(validateBriefing(bad)).toBe(false);
  });

  it('rejects global_indices item missing name', () => {
    const bad = { ...baseV1, summary: { ...baseV1.summary, global_indices: [{ change_pct: 1 }] } };
    expect(validateBriefing(bad)).toBe(false);
  });

  it('rejects global_indices item with non-number/non-null change_pct', () => {
    const bad = { ...baseV1, summary: { ...baseV1.summary, global_indices: [{ name: 'Dow', change_pct: 'up' }] } };
    expect(validateBriefing(bad)).toBe(false);
  });

  it('accepts fully populated v2 fields', () => {
    const good = {
      ...baseV1,
      meta: { ...baseV1.meta, sources: ['Reuters', 'NSE'] },
      summary: {
        ...baseV1.summary,
        macro: { ...baseV1.summary.macro, usd_inr: 83.4, gold: 71500, india_vix: 13.8, us_10y_yield: 4.28 },
        global_indices: [{ name: 'Dow Jones', change_pct: -0.3 }],
      },
      deep_dive: { ...baseV1.deep_dive, summary_takeaway: 'Short takeaway.' },
    };
    expect(validateBriefing(good)).toBe(true);
  });
});

// ── Unit tests for concrete valid/invalid examples ────────────────
describe('Unit: concrete validation examples', () => {
  const validBriefing = {
    meta: { date: '2026-06-22', session_status: 'Trading', market_tone: 'Cautiously bullish' },
    summary: {
      nifty50: { close: 24580.5, change_pct: 0.73 },
      sensex: { close: 80924.3, change_pct: 0.68 },
      broader_market: { smallcap_pct: 1.2, midcap_pct: 0.9 },
      breadth: { nifty500_advances: 312, nifty500_declines: 188 },
      sectors: { leaders: ['IT'], laggards: ['FMCG'], count_advanced: 8 },
      key_gainers: [{ symbol: 'INFY', change_pct: 3.1 }],
      key_losers: [{ symbol: 'HDFC', change_pct: -1.8 }],
      institutional_flows: { fii_net_cr: -850.5, dii_net_cr: 1240.0 },
      macro: { brent_crude: 84.2, india_10y_yield: 6.98 },
    },
    triggers: { domestic: ['RBI'], global: ['US Fed'] },
    deep_dive: { full_text: 'Analysis text.' },
    outlook: {
      base_case: 'Range-bound',
      scenarios: [{ name: 'Bullish', probability: 55, range_low: 24500, range_high: 24900 }],
      support_levels: [24300],
      resistance_levels: [24900],
      key_watch: ['FII flow'],
    },
    prediction_result: {
      actual_close: 24612.0,
      actual_change_pct: 0.86,
      matched_scenario: 'Bullish',
      accuracy_tag: 'Correct',
      verified_at: '2026-06-22T11:00:00Z',
    },
    admin_notes: null,
  };

  it('accepts the 2026-06-22 fixture', () => {
    expect(validateBriefing(validBriefing)).toBe(true);
  });

  it('rejects null/undefined input', () => {
    expect(validateBriefing(null)).toBe(false);
    expect(validateBriefing(undefined)).toBe(false);
    expect(validateBriefing({})).toBe(false);
  });

  it('accepts accuracy_tag null', () => {
    const b = { ...validBriefing, prediction_result: { ...validBriefing.prediction_result, accuracy_tag: null } };
    expect(validateBriefing(b)).toBe(true);
  });

  it('rejects invalid accuracy_tag enum', () => {
    const b = { ...validBriefing, prediction_result: { ...validBriefing.prediction_result, accuracy_tag: 'Maybe' } };
    expect(validateBriefing(b)).toBe(false);
  });
});
