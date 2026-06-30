// Data access layer — the sole fetch surface for NSE Pulse
import { getLatestDate as coreLatestDate } from './core.js';

const CONFIG = {
  dataBaseUrl: 'https://bmdeshmukh18.github.io/briefing/data',
  accessControlEnabled: false,
  adminViewEnabled: false,
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

export const DataAccess = {
  config: CONFIG,

  async getIndex() {
    return fetchJSON(`${CONFIG.dataBaseUrl}/index.json`);
  },

  async getHistory() {
    return fetchJSON(`${CONFIG.dataBaseUrl}/history.json`);
  },

  async getBriefing(dateStr) {
    return fetchJSON(`${CONFIG.dataBaseUrl}/briefings/${dateStr}.json`);
  },

  getLatestDate(index) {
    return coreLatestDate(index);
  },
};
