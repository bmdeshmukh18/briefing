// NSE Pulse Admin Interface
// Allows admin to login, paste briefing JSON, and publish to GitHub via API

const ADMIN_PASSWORD = "admin123"; // CHANGE THIS TO A SECURE PASSWORD OR IMPLEMENT BETTER AUTH

// DOM Elements
const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginBtn = document.getElementById('login-btn');
const passwordInput = document.getElementById('admin-password');
const loginError = document.getElementById('login-error');

const validateBtn = document.getElementById('validate-btn');
const publishBtn = document.getElementById('publish-btn');
const clearBtn = document.getElementById('clear-btn');
const briefingInput = document.getElementById('briefing-json');
const statusOutput = document.getElementById('status-output');
const repoOwnerInput = document.getElementById('repo-owner');
const repoNameInput = document.getElementById('repo-name');
const githubTokenInput = document.getElementById('github-token');

// State
let isLoggedIn = false;

// Initialize
function init() {
  const loggedIn = sessionStorage.getItem('adminLoggedIn') === 'true';
  if (loggedIn) {
    showAdminSection();
  } else {
    showLoginSection();
  }

  loginBtn.addEventListener('click', handleLogin);
  validateBtn.addEventListener('click', handleValidate);
  publishBtn.addEventListener('click', handlePublish);
  clearBtn.addEventListener('click', handleClear);
  passwordInput.addEventListener('keypress', e => { if (e.key === 'Enter') loginBtn.click(); });
}

// Show/Hide Sections
function showLoginSection() {
  loginSection.classList.remove('hidden');
  adminSection.classList.add('hidden');
  passwordInput.value = '';
  loginError.classList.add('hidden');
  sessionStorage.removeItem('adminLoggedIn');
  isLoggedIn = false;
}

function showAdminSection() {
  loginSection.classList.add('hidden');
  adminSection.classList.remove('hidden');
  sessionStorage.setItem('adminLoggedIn', 'true');
  isLoggedIn = true;
  briefingInput.focus();
}

// Event Handlers
function handleLogin() {
  const password = passwordInput.value.trim();
  if (password === ADMIN_PASSWORD) {
    showAdminSection();
  } else {
    loginError.textContent = 'Invalid password';
    loginError.classList.remove('hidden');
    passwordInput.value = '';
  }
}

function handleValidate() {
  const jsonText = briefingInput.value.trim();
  if (!jsonText) {
    showStatus('Please paste JSON content', 'error');
    return;
  }
  try {
    const parsed = JSON.parse(jsonText);
    // Basic validation
    if (!parsed.meta || !parsed.meta.date) {
      throw new Error('Missing meta.date');
    }
    const date = parsed.meta.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Invalid date format in meta.date (expected YYYY-MM-DD)');
    }
    // Additional validation can be added here
    showStatus('JSON is valid. Ready to publish.', 'success');
    publishBtn.disabled = false;
  } catch (err) {
    showStatus(`Invalid JSON: ${err.message}`, 'error');
    publishBtn.disabled = true;
  }
}

function handleClear() {
  briefingInput.value = '';
  showStatus('');
  publishBtn.disabled = true;
}

async function handlePublish() {
  // Disable UI
  publishBtn.disabled = true;
  validateBtn.disabled = true;
  clearBtn.disabled = true;
  showStatus('Publishing...', 'info');

  try {
    const owner = repoOwnerInput.value.trim();
    const repo = repoNameInput.value.trim();
    const token = githubTokenInput.value.trim();
    const jsonText = briefingInput.value.trim();

    if (!owner || !repo || !token || !jsonText) {
      throw new Error('Please fill in all fields');
    }

    const briefing = JSON.parse(jsonText);
    const date = briefing.meta.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Invalid date in meta.date');
    }

    // GitHub API base
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    // Helper to fetch file
    async function getFile(path) {
      const resp = await fetch(`${apiBase}/${path}?ref=main`, { headers });
      if (!resp.ok) {
        if (resp.status === 404) return { content: null, sha: null };
        throw new Error(`Failed to fetch ${path}: ${resp.status}`);
      }
      const data = await resp.json();
      return {
        content: atob(data.content),
        sha: data.sha
      };
    }

    // Helper to update file
    async function updateFile(path, newContent, commitMessage) {
      const { content: oldContent, sha } = await getFile(path);
      const newContentB64 = btoa(newContent);
      const putData = {
        message: commitMessage,
        content: newContentB64,
        branch: 'main'
      };
      if (sha) putData.sha = sha;
      const resp = await fetch(`${apiBase}/${path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(putData)
      });
      if (!resp.ok) {
        const errorData = await resp.json();
        throw new Error(`Failed to update ${path}: ${resp.status} ${errorData.message}`);
      }
      return await resp.json();
    }

    // 1. Update briefing file
    const briefingPath = `data/briefings/${date}.json`;
    const briefingContent = JSON.stringify(briefing, null, 2); // pretty print
    await updateFile(briefingPath, briefingContent, `Add briefing for ${date}`);
    showStatus(`Updated briefing file: ${briefingPath}`, 'info');

    // 2. Update index.json
    const indexPath = 'data/index.json';
    const { content: indexContent, sha: indexSha } = await getFile(indexPath);
    let indexObj = { dates: [] };
    if (indexContent) {
      try {
        indexObj = JSON.parse(indexContent);
      } catch (e) {
        // If malformed, start fresh
        indexObj = { dates: [] };
      }
    }
    if (!Array.isArray(indexObj.dates)) indexObj.dates = [];
    if (!indexObj.dates.includes(date)) {
      indexObj.dates.push(date);
      indexObj.dates.sort((a, b) => a.localeCompare(b));
    }
    const newIndexContent = JSON.stringify(indexObj, null, 2);
    await updateFile(indexPath, newIndexContent, `Update index for ${date}`);
    showStatus('Updated index.json', 'info');

    // 3. Update history.json
    const historyPath = 'data/history.json';
    const { content: historyContent, sha: historySha } = await getFile(historyPath);
    let historyObj = { series: [] };
    if (historyContent) {
      try {
        historyObj = JSON.parse(historyContent);
      } catch (e) {
        historyObj = { series: [] };
      }
    }
    if (!Array.isArray(historyObj.series)) historyObj.series = [];

    // Build history row from briefing summary
    const s = briefing.summary || {};
    const newRow = {
      date: date,
      nifty_close: s.nifty50?.close ?? null,
      nifty_change_pct: s.nifty50?.change_pct ?? null,
      fii_net_cr: s.institutional_flows?.fii_net_cr ?? null,
      dii_net_cr: s.institutional_flows?.dii_net_cr ?? null,
      advances: s.breadth?.nifty500_advances ?? null,
      declines: s.breadth?.nifty500_declines ?? null
    };

    // Replace existing or append
    const existingIndex = historyObj.series.findIndex(r => r.date === date);
    if (existingIndex >= 0) {
      historyObj.series[existingIndex] = newRow;
    } else {
      historyObj.series.push(newRow);
    }
    // Sort series by date ascending
    historyObj.series.sort((a, b) => a.date.localeCompare(b.date));

    const newHistoryContent = JSON.stringify(historyObj, null, 2);
    await updateFile(historyPath, newHistoryContent, `Update history for ${date}`);
    showStatus('Updated history.json', 'info');

    showStatus(`✅ Published briefing for ${date}!`, 'success');
  } catch (err) {
    console.error(err);
    showStatus(`❌ Error: ${err.message}`, 'error');
  } finally {
    publishBtn.disabled = false;
    validateBtn.disabled = false;
    clearBtn.disabled = false;
  }
}

function showStatus(message, type = '') {
  if (!message) {
    statusOutput.classList.add('hidden');
    statusOutput.textContent = '';
    return;
  }
  statusOutput.textContent = message;
  statusOutput.className = 'status';
  if (type) statusOutput.classList.add(type);
  statusOutput.classList.remove('hidden');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);