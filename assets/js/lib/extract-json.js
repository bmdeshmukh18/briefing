// Deterministic fenced-JSON / balanced-brace extraction — shared contract
// with the n8n ingestion workflow's inline "Extract JSON Block" Function node.
// Keep both copies in sync; n8n cannot `import` this file.

export function extractJsonBlock(rawText) {
  if (typeof rawText !== 'string') return null;
  const fenced = rawText.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return extractFirstBalancedObject(rawText);
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
