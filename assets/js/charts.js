// NSE Pulse — track-record charts (Chart.js 4, loaded via CDN global)
import { windowSeries } from './lib/core.js';

const INK_DIM = '#8a93ac', LINE = '#262e47', SAFFRON = '#e8a33d', UP = '#3bc98a', DOWN = '#e5566a';

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: INK_DIM, font: { family: "'IBM Plex Mono', monospace", size: 10 }, boxWidth: 10 } } },
  scales: {
    x: { ticks: { color: INK_DIM, font: { family: "'IBM Plex Mono', monospace", size: 9 } }, grid: { color: LINE } },
    y: { ticks: { color: INK_DIM, font: { family: "'IBM Plex Mono', monospace", size: 9 } }, grid: { color: LINE } },
  },
};

let charts = [];

export function destroyCharts() {
  charts.forEach(c => c.destroy());
  charts = [];
}

export function initCharts(history) {
  destroyCharts();
  const rows = windowSeries(history?.series ?? [], 30);
  if (!rows.length) {
    document.querySelectorAll('.chart-panel').forEach(p => {
      p.innerHTML = '<p class="empty-note">No historical data available yet.</p>';
    });
    return;
  }
  const labels = rows.map(r => r.date.slice(5)); // MM-DD
  const val = key => rows.map(r => (typeof r[key] === 'number' ? r[key] : null));

  charts.push(new Chart(document.getElementById('chart-nifty'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Nifty 50 close', data: val('nifty_close'), borderColor: SAFFRON, backgroundColor: SAFFRON, pointRadius: 3, tension: 0.25, spanGaps: false }] },
    options: BASE_OPTS,
  }));

  charts.push(new Chart(document.getElementById('chart-flows'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'FII net ₹cr', data: val('fii_net_cr'), backgroundColor: DOWN },
        { label: 'DII net ₹cr', data: val('dii_net_cr'), backgroundColor: UP },
      ],
    },
    options: BASE_OPTS,
  }));

  charts.push(new Chart(document.getElementById('chart-breadth'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Advances', data: val('advances'), backgroundColor: UP, stack: 'b' },
        { label: 'Declines', data: val('declines').map(v => (v == null ? null : -v)), backgroundColor: DOWN, stack: 'b' },
      ],
    },
    options: BASE_OPTS,
  }));
}

export function wireChartTabs(container) {
  container.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.chart-tab').forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      container.querySelectorAll('.chart-panel').forEach(p => {
        p.hidden = p.dataset.panel !== tab.dataset.chart;
      });
    });
  });
}
