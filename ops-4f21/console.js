// NSE Pulse — Publish Console
// Fallback path for when the n8n ingestion pipeline is unavailable: paste the raw
// ChatGPT/Gmail briefing (narrative + fenced ```json STRUCTURED DATA block), extract
// and validate the JSON through the exact same shared logic the main site uses, then
// publish via the Cloudflare Worker (which holds the GitHub token server-side).
import { extractJsonBlock } from '../assets/js/lib/extract-json.js';
import { validateBriefing, normalizeBriefing } from '../assets/js/lib/schema.js';
import { upsertIndexDate, upsertHistoryRow, buildHistoryRow } from '../assets/js/lib/core.js';
import { DataAccess } from '../assets/js/lib/data-access.js';

// This page is nested one level under the site root.
DataAccess.config.dataBaseUrl = '/data';

// The real access control for this page is Cloudflare Access, configured at the
// edge in front of /ops-4f21/* and /api/publish* — see the deployment checklist.
// This username field is a UI role router only; it grants no access by itself.
const ADMIN_USERNAME = 'bmdeshmukh18';
const WORKER_URL = 'https://briefanalytics.bmdeshmukh18.in/api/publish';

// ── Theme (same convention as assets/js/app.js) ────────────────────
const LIGHT_THEMES = ['daylight'];
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('nse-pulse-theme', theme);
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === theme));
  const toggleBtn = document.getElementById('toggle-dark-btn');
  if (toggleBtn) toggleBtn.textContent = LIGHT_THEMES.includes(theme) ? '☾' : '☀';
}
function initTheme() {
  applyTheme(localStorage.getItem('nse-pulse-theme') ?? 'terminal');
  document.querySelectorAll('.theme-swatch').forEach(s => s.addEventListener('click', () => applyTheme(s.dataset.theme)));
  document.getElementById('toggle-dark-btn')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme ?? 'terminal';
    applyTheme(LIGHT_THEMES.includes(current) ? 'terminal' : 'daylight');
  });
}

// ── DOM ─────────────────────────────────────────────────────────────
const loginCard = document.getElementById('login-card');
const publishCard = document.getElementById('publish-card');
const placeholderCard = document.getElementById('placeholder-card');
const usernameInput = document.getElementById('username-input');
const continueBtn = document.getElementById('continue-btn');

const rawInput = document.getElementById('raw-input');
const parseBtn = document.getElementById('parse-btn');
const publishBtn = document.getElementById('publish-btn');
const clearBtn = document.getElementById('clear-btn');
const errorsEl = document.getElementById('validation-errors');
const previewEl = document.getElementById('json-preview');
const resultEl = document.getElementById('publish-result');

let pendingPayload = null; // { date, briefing, index, history } — set by a successful parse

// ── Role routing ────────────────────────────────────────────────────
function handleContinue() {
  const username = usernameInput.value.trim().toLowerCase();
  loginCard.hidden = true;
  if (username === ADMIN_USERNAME) {
    publishCard.hidden = false;
  } else {
    placeholderCard.hidden = false;
  }
}

// ── Diagnostics (advisory only — the real accept/reject gate is validateBriefing) ──
function diagnose(obj) {
  const issues = [];
  if (!obj || typeof obj !== 'object') return ['Parsed content is not a JSON object.'];
  if (!obj.meta?.date || !/^\d{4}-\d{2}-\d{2}$/.test(obj.meta.date)) issues.push('meta.date is missing or not in YYYY-MM-DD format.');
  if (!['Trading', 'Holiday'].includes(obj.meta?.session_status)) issues.push('meta.session_status must be exactly "Trading" or "Holiday".');
  const scenarios = obj.outlook?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length < 1 || scenarios.length > 5) issues.push('outlook.scenarios must have between 1 and 5 entries.');
  else for (const s of scenarios) {
    if (typeof s.range_low === 'number' && typeof s.range_high === 'number' && s.range_low > s.range_high) {
      issues.push(`Scenario "${s.name}" has range_low > range_high.`);
    }
  }
  if (issues.length === 0) issues.push('Briefing failed schema validation — check field types and required keys against design.md.');
  return issues;
}

function showErrors(messages) {
  errorsEl.innerHTML = messages.map(m => `<li>${m}</li>`).join('');
  errorsEl.hidden = false;
  previewEl.hidden = true;
  publishBtn.disabled = true;
  pendingPayload = null;
}

function showResult(message, type) {
  resultEl.textContent = message;
  resultEl.className = `publish-result ${type}`;
  resultEl.hidden = false;
}

// ── Parse flow ──────────────────────────────────────────────────────
async function handleParse() {
  errorsEl.hidden = true;
  previewEl.hidden = true;
  resultEl.hidden = true;
  publishBtn.disabled = true;
  pendingPayload = null;

  const raw = rawInput.value;
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) {
    showErrors(['No JSON block found in the pasted content. Expect a fenced ```json ... ``` STRUCTURED DATA block.']);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    showErrors([`Extracted content is not valid JSON: ${err.message}`]);
    return;
  }

  const normalized = normalizeBriefing(parsed);
  if (!validateBriefing(normalized)) {
    showErrors(diagnose(normalized));
    return;
  }

  const date = normalized.meta.date;
  let index, history;
  try {
    [index, history] = await Promise.all([DataAccess.getIndex(), DataAccess.getHistory()]);
  } catch {
    showErrors(['Could not load the current index.json/history.json to compute the update — check your connection and retry.']);
    return;
  }

  const updatedIndex = upsertIndexDate(index, date);
  const updatedHistory = upsertHistoryRow(history, buildHistoryRow(normalized));

  pendingPayload = { date, briefing: normalized, index: updatedIndex, history: updatedHistory };
  previewEl.textContent = JSON.stringify(normalized, null, 2);
  previewEl.hidden = false;
  publishBtn.disabled = false;
}

// ── Publish flow ────────────────────────────────────────────────────
async function handlePublish() {
  if (!pendingPayload) return;
  publishBtn.disabled = true;
  parseBtn.disabled = true;
  resultEl.hidden = true;

  try {
    const resp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingPayload),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) {
      showResult(`Publish failed: ${body.message ?? resp.statusText}`, 'error');
      publishBtn.disabled = false;
      return;
    }
    showResult(`Published ${pendingPayload.date}.`, 'success');
    handleClear();
  } catch (err) {
    showResult(`Publish failed: ${err.message}`, 'error');
    publishBtn.disabled = false;
  } finally {
    parseBtn.disabled = false;
  }
}

function handleClear() {
  rawInput.value = '';
  errorsEl.hidden = true;
  previewEl.hidden = true;
  publishBtn.disabled = true;
  pendingPayload = null;
}

function init() {
  initTheme();
  continueBtn.addEventListener('click', handleContinue);
  usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') continueBtn.click(); });
  parseBtn.addEventListener('click', handleParse);
  publishBtn.addEventListener('click', handlePublish);
  clearBtn.addEventListener('click', handleClear);
}

document.addEventListener('DOMContentLoaded', init);
