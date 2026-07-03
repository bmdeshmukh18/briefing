// Deterministic fenced-JSON / balanced-brace extraction — shared contract
// with the n8n ingestion workflow's inline "Extract JSON Block" Function node.
// Keep both copies in sync; n8n cannot `import` this file.

export function extractJsonBlock(rawText) {
  if (typeof rawText !== 'string') return null;
  const fenced = rawText.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : extractFirstBalancedObject(rawText);
  return candidate === null ? null : sanitizeStringNewlines(candidate);
}

// Mail transfer agents / plain-text email rendering commonly hard-wrap long
// lines (RFC 2822 line-length limits, format=flowed soft breaks). A JSON blob
// emitted as a single long line can arrive with a raw newline injected in the
// middle of a string value, which JSON.parse rejects as a bad control
// character. Since that newline is meaningless JSON structure either way,
// collapse it to a space rather than fail the whole parse.
function sanitizeStringNewlines(text) {
  let result = '';
  let inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; result += ch; continue; }
      if (ch === '\\') { escaped = true; result += ch; continue; }
      if (ch === '"') { inString = false; result += ch; continue; }
      result += (ch === '\n' || ch === '\r') ? ' ' : ch;
      continue;
    }
    if (ch === '"') inString = true;
    result += ch;
  }
  return result;
}

export function extractFirstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // unbalanced — no complete object found
}
