// NSE Pulse — Publish Worker
// Holds the GitHub token server-side so it never reaches the browser. The publish
// console (ops-4f21/console.js) POSTs a pre-computed { date, briefing, index, history }
// payload here; this Worker validates it against the same shared schema the site
// uses, then writes the three files to GitHub via the Contents API.
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return jsonResponse(405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.' });
    }

    // Defense-in-depth: Cloudflare Access should already restrict who can reach
    // this route. This is a second check on the identity Access injects.
    const authedEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
    if (!env.ALLOWED_EMAIL || authedEmail !== env.ALLOWED_EMAIL) {
      return jsonResponse(401, { ok: false, error: 'UNAUTHORIZED', message: 'Not authorized to publish.' });
    }

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
  },
};
