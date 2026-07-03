// Feature: nse-pulse — JSON-block extraction tests
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { extractJsonBlock, extractFirstBalancedObject } from '../assets/js/lib/extract-json.js';

describe('extractJsonBlock: fenced block extraction', () => {
  it('extracts JSON from a ```json fenced block embedded in prose', () => {
    const wrapped = `Some narrative text before.\n\n\`\`\`json\n{"a": 1, "b": [1,2,3]}\n\`\`\`\n\nTrailing text.`;
    expect(extractJsonBlock(wrapped)).toBe('{"a": 1, "b": [1,2,3]}');
  });

  it('is case-insensitive on the json fence tag', () => {
    const wrapped = '```JSON\n{"x": true}\n```';
    expect(JSON.parse(extractJsonBlock(wrapped))).toEqual({ x: true });
  });
});

describe('extractJsonBlock: balanced-brace fallback', () => {
  it('extracts a balanced object when no fence is present, including nested braces', () => {
    const wrapped = 'Hello {"a": {"b": 1}, "c": "text with } brace-like char"} world';
    const result = extractJsonBlock(wrapped);
    expect(JSON.parse(result)).toEqual({ a: { b: 1 }, c: 'text with } brace-like char' });
  });

  it('ignores braces inside string literals when balancing', () => {
    const wrapped = '{"note": "unbalanced { inside a string"}';
    expect(JSON.parse(extractJsonBlock(wrapped))).toEqual({ note: 'unbalanced { inside a string' });
  });

  it('returns null when no JSON object is present', () => {
    expect(extractJsonBlock('just plain prose, nothing structured here')).toBeNull();
  });

  it('returns null (never throws) on an unbalanced/truncated object', () => {
    expect(extractFirstBalancedObject('{"a": 1, "b": [1,2,3]')).toBeNull();
  });

  it('returns null for non-string input without throwing', () => {
    expect(extractJsonBlock(null)).toBeNull();
    expect(extractJsonBlock(undefined)).toBeNull();
    expect(extractJsonBlock(42)).toBeNull();
  });

  it('parses a JSON block with a raw newline hard-wrapped inside a string value', () => {
    // Simulates a mail transfer agent/plain-text renderer hard-wrapping a long
    // single-line JSON blob, injecting a literal newline mid-string — which
    // JSON.parse otherwise rejects as a bad control character.
    const wrapped = '```json\n{"note": "a long sentence that got hard\nwrapped mid-value"}\n```';
    expect(JSON.parse(extractJsonBlock(wrapped))).toEqual({ note: 'a long sentence that got hard wrapped mid-value' });
  });
});

describe('Property: round-trip through arbitrary prose wrapping', () => {
  // fc.object() always yields a plain object (never a top-level array), so the
  // serialized form always starts with '{' — required for the balanced-brace fallback.
  const genJsonObject = fc.object({ maxDepth: 2 });

  // Prose must not itself contain '{', '}', or a backtick — those would make the
  // surrounding text ambiguous with the JSON payload being tested, which is a
  // property of adversarial input, not of "arbitrary prose", and isn't what this
  // property is checking.
  const genProse = fc.string({ maxLength: 40 }).filter(s => !/[{}`]/.test(s));

  it('JSON.parse(extractJsonBlock(wrap(obj))) deep-equals the original object', () => {
    fc.assert(fc.property(
      genJsonObject,
      genProse,
      genProse,
      (obj, prefix, suffix) => {
        const serialized = JSON.stringify(obj);
        const wrapped = `${prefix}\n${serialized}\n${suffix}`;
        const extracted = extractJsonBlock(wrapped);
        expect(extracted).not.toBeNull();
        // Compare against JSON's own round-trip (not the raw generated `obj`): JSON
        // normalizes values like `undefined` inside arrays to `null` on stringify,
        // which is a property of JSON itself, not of the extractor being tested.
        expect(JSON.parse(extracted)).toEqual(JSON.parse(serialized));
      }
    ), { numRuns: 100 });
  });

  it('prefers the fenced block over a balanced-brace match when both are present', () => {
    const wrapped = 'prose {"decoy": true}\n```json\n{"real": 1}\n```';
    expect(JSON.parse(extractJsonBlock(wrapped))).toEqual({ real: 1 });
  });
});
