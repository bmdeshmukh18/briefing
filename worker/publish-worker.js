// NSE Pulse — Publish Worker
// Holds the GitHub token and OpenAI key server-side so neither reaches the browser.
// Two routes:
//   POST /api/publish — the console POSTs a pre-computed { date, briefing, index, history }
//     payload; this validates it against the same shared schema the site uses, then
//     writes the three files to GitHub via the Contents API.
//   POST /api/parse — fallback for when the pasted content has no fenced ```json
//     block (e.g. an older-format email). Sends the raw text to an LLM with a strict
//     schema-shaped system prompt (mirrors what the old n8n OpenAI Parser node did
//     before ChatGPT started emitting the JSON block directly) and returns the parsed
//     object for the console to normalize/validate exactly like the deterministic path.
import { validateBriefing } from '../assets/js/lib/schema.js';

const ALLOWED_ORIGIN = 'https://briefanalytics.bmdeshmukh18.in';
const REPO_OWNER = 'bmdeshmukh18';
const REPO_NAME = 'briefing';
const REPO_BRANCH = 'main';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function githubRequest(env, path, init) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'nse-pulse-publish-worker',
      ...(init?.headers ?? {}),
    },
  });
}

async function getFileSha(env, path) {
  const resp = await githubRequest(env, `${path}?ref=${REPO_BRANCH}`, { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
  const data = await resp.json();
  return data.sha ?? null;
}

async function putFile(env, path, content, message) {
  const sha = await getFileSha(env, path);
  const resp = await githubRequest(env, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(content),
      branch: REPO_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(`PUT ${path} failed: ${resp.status} ${errBody.message ?? ''}`);
  }
  const data = await resp.json();
  return data.commit?.sha ?? null;
}

function isAuthorized(request, env) {
  // Defense-in-depth: Cloudflare Access should already restrict who can reach
  // this route. This is a second check on the identity Access injects.
  const authedEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  return !!env.ALLOWED_EMAIL && authedEmail === env.ALLOWED_EMAIL;
}

async function handlePublish(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'INVALID_BODY', message: 'Request body is not valid JSON.' });
  }

  const { date, briefing, index, history } = body ?? {};
  if (
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !briefing || typeof briefing !== 'object' ||
    !index || typeof index !== 'object' ||
    !history || typeof history !== 'object'
  ) {
    return jsonResponse(400, { ok: false, error: 'INVALID_BODY', message: 'Body must include date, briefing, index, and history objects.' });
  }

  if (!validateBriefing(briefing)) {
    return jsonResponse(422, { ok: false, error: 'SCHEMA_INVALID', message: 'Briefing failed schema validation.' });
  }

  try {
    const commits = {};
    commits.briefing = await putFile(env, `data/briefings/${date}.json`, JSON.stringify(briefing, null, 2), `Publish briefing for ${date}`);
    commits.index = await putFile(env, 'data/index.json', JSON.stringify(index, null, 2), `Update index for ${date}`);
    commits.history = await putFile(env, 'data/history.json', JSON.stringify(history, null, 2), `Update history for ${date}`);
    return jsonResponse(200, { ok: true, date, commits });
  } catch (err) {
    return jsonResponse(502, { ok: false, error: 'GITHUB_API_ERROR', message: err.message });
  }
}

// ── AI parse fallback (no fenced JSON block found in the pasted content) ──
const PARSE_SYSTEM_PROMPT = `You are a financial data extractor. Extract NSE market briefing data from the provided text and return ONLY a JSON object conforming exactly to this schema. NEVER omit any field — use null (or [] for list fields) for any value that is absent or unclear. Never guess a number.

Schema:
{
  "meta": {
    "date": "YYYY-MM-DD",
    "session_status": "Trading" or "Holiday",
    "market_tone": string (<=60 chars) or null,
    "sources": [string]
  },
  "summary": {
    "nifty50": { "close": number or null, "change_pct": number or null },
    "sensex": { "close": number or null, "change_pct": number or null },
    "broader_market": { "smallcap_pct": number or null, "midcap_pct": number or null },
    "breadth": { "nifty500_advances": number or null, "nifty500_declines": number or null },
    "sectors": { "leaders": [string], "laggards": [string], "count_advanced": number or null },
    "key_gainers": [{ "symbol": string, "change_pct": number or null }],
    "key_losers": [{ "symbol": string, "change_pct": number or null }],
    "institutional_flows": { "fii_net_cr": number or null, "dii_net_cr": number or null },
    "macro": {
      "brent_crude": number or null, "india_10y_yield": number or null,
      "usd_inr": number or null, "gold": number or null,
      "india_vix": number or null, "us_10y_yield": number or null
    },
    "global_indices": [{ "name": string, "change_pct": number or null }]
  },
  "triggers": { "domestic": [string], "global": [string] },
  "deep_dive": {
    "full_text": string or null,
    "summary_takeaway": string (<=280 chars) or null
  },
  "outlook": {
    "base_case": string or null,
    "scenarios": [ { "name": string, "probability": 0-100, "range_low": number, "range_high": number } ],
    "support_levels": [number],
    "resistance_levels": [number],
    "key_watch": [string]
  },
  "prediction_result": { "actual_close": null, "actual_change_pct": null, "matched_scenario": null, "accuracy_tag": null, "verified_at": null }
}

Rules:
- prediction_result fields MUST always be null (filled by automation later).
- session_status: use "Trading" unless the text explicitly says it was a holiday/non-trading day.
- date: the actual session date mentioned in the text, in YYYY-MM-DD.
- scenarios: 1-5 items, range_low must be <= range_high, probability 0-100.
- Return ONLY the JSON object — no prose, no markdown fences, no commentary.`;

async function handleParse(request, env) {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse(500, { ok: false, error: 'NOT_CONFIGURED', message: 'AI parsing is not configured (missing OPENAI_API_KEY).' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'INVALID_BODY', message: 'Request body is not valid JSON.' });
  }

  const text = body?.text;
  if (typeof text !== 'string' || text.trim().length < 50) {
    return jsonResponse(400, { ok: false, error: 'INVALID_BODY', message: 'Body must include a non-trivial "text" string.' });
  }

  let aiResp;
  try {
    aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 4096,
        messages: [
          { role: 'system', content: PARSE_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    });
  } catch (err) {
    return jsonResponse(502, { ok: false, error: 'OPENAI_ERROR', message: err.message });
  }

  if (!aiResp.ok) {
    const errBody = await aiResp.json().catch(() => ({}));
    return jsonResponse(502, { ok: false, error: 'OPENAI_ERROR', message: errBody?.error?.message ?? `OpenAI returned ${aiResp.status}` });
  }

  const aiData = await aiResp.json();
  let briefing;
  try {
    briefing = JSON.parse(aiData.choices?.[0]?.message?.content ?? '');
  } catch (err) {
    return jsonResponse(502, { ok: false, error: 'OPENAI_ERROR', message: `Model did not return valid JSON: ${err.message}` });
  }

  return jsonResponse(200, { ok: true, briefing });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return jsonResponse(405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.' });
    }
    if (!isAuthorized(request, env)) {
      return jsonResponse(401, { ok: false, error: 'UNAUTHORIZED', message: 'Not authorized.' });
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/api/publish') return handlePublish(request, env);
    if (pathname === '/api/parse') return handleParse(request, env);
    return jsonResponse(404, { ok: false, error: 'NOT_FOUND', message: `No route for ${pathname}` });
  },
};
