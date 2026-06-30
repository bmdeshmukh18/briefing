// NSE Pulse — Charts Module (Chart.js 4)
import { windowSeries, plottablePoints } from './lib/core.js';
import { DataAccess } from './lib/data-access.js';

const CHART_COLORS = {
  nifty:    '#0FC6A0',
  fii:      '#FF5370',
  dii:      '#4FC3F7',
  advances: '#4ADE80',
  declines: '#F87171',
  sectors:  '#F5A623',
};

let charts = {};

export async function initCharts() {
  const root = document.getElementById('charts-root');
  if (!root) return;

  let history;
  try {
    history = await DataAccess.getHistory();
  } catch {
    root.innerHTML = '<p class="empty-msg">Historical chart data unavailable.</p>';
    return;
  }

  const series = windowSeries(history.series ?? [], 30);

  if (series.length === 0) {
    root.innerHTML = '<p class="empty-msg">No historical data available yet.</p>';
    return;
  }

  root.innerHTML = buildChartsHTML();
  setupTabs();
  renderAllCharts(series);
}

function buildChartsHTML() {
  return `
    <div class="chart-tabs" role="tablist">
      <button class="tab-btn active" data-tab="nifty" role="tab" aria-selected="true">Nifty Trend</button>
      <button class="tab-btn" data-tab="flows" role="tab" aria-selected="false">FII / DII Flows</button>
      <button class="tab-btn" data-tab="breadth" role="tab" aria-selected="false">Market Breadth</button>
      <button class="tab-btn" data-tab="sectors" role="tab" aria-selected="false">Sectors</button>
    </div>
    <div class="tab-panels">
      <div class="tab-panel active" id="tab-nifty" role="tabpanel">
        <div class="chart-canvas-wrap"><canvas id="chart-nifty" aria-label="Nifty 50 trend chart"></canvas></div>
      </div>
      <div class="tab-panel" id="tab-flows" role="tabpanel">
        <div class="chart-canvas-wrap"><canvas id="chart-flows" aria-label="FII and DII flows chart"></canvas></div>
      </div>
      <div class="tab-panel" id="tab-breadth" role="tabpanel">
        <div class="chart-canvas-wrap"><canvas id="chart-breadth" aria-label="Market breadth chart"></canvas></div>
      </div>
      <div class="tab-panel" id="tab-sectors" role="tabpanel">
        <div class="chart-canvas-wrap"><canvas id="chart-sectors" aria-label="Sectors advanced count chart"></canvas></div>
      </div>
    </div>`;
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function getGridColor() {
  const theme = document.documentElement.dataset.theme ?? 'terminal';
  const colors = {
    terminal: 'rgba(26,45,90,0.6)',
    daylight: 'rgba(221,227,238,0.8)',
    dusk:     'rgba(46,42,36,0.6)',
    forest:   'rgba(26,61,40,0.6)',
  };
  return colors[theme] ?? colors.terminal;
}

function getTextColor() {
  const theme = document.documentElement.dataset.theme ?? 'terminal';
  const colors = {
    terminal: '#6B8499',
    daylight: '#4A5568',
    dusk:     '#8C7B6A',
    forest:   '#5A8A6A',
  };
  return colors[theme] ?? colors.terminal;
}

function baseOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    spanGaps: true,
    plugins: {
      legend: {
        labels: { color: getTextColor(), font: { family: 'DM Sans', size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: 'rgba(10,22,40,0.95)',
        titleColor: '#E8F4F8',
        bodyColor: '#6B8499',
        borderColor: '#1A2D5A',
        borderWidth: 1,
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
      },
    },
    scales: {
      x: {
        ticks: { color: getTextColor(), font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 45 },
        grid: { color: getGridColor() },
      },
      y: {
        ticks: { color: getTextColor(), font: { family: 'JetBrains Mono', size: 10 } },
        grid: { color: getGridColor() },
      },
    },
  };
}

function renderAllCharts(series) {
  const labels = series.map(r => r.date.slice(5)); // MM-DD

  // Nifty Trend
  const niftyPts = plottablePoints(series, 'nifty_close');
  charts.nifty = new Chart(document.getElementById('chart-nifty'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Nifty 50',
        data: niftyPts.map(p => p.y),
        borderColor: CHART_COLORS.nifty,
        backgroundColor: 'rgba(15,198,160,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: CHART_COLORS.nifty,
      }],
    },
    options: baseOptions('Nifty 50 Trend'),
  });

  // FII/DII Flows
  const fiiPts = plottablePoints(series, 'fii_net_cr');
  const diiPts = plottablePoints(series, 'dii_net_cr');
  charts.flows = new Chart(document.getElementById('chart-flows'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'FII Net (₹ Cr)',
          data: fiiPts.map(p => p.y),
          backgroundColor: fiiPts.map(p => p.y >= 0 ? 'rgba(15,198,160,0.7)' : 'rgba(255,83,112,0.7)'),
          borderRadius: 3,
        },
        {
          label: 'DII Net (₹ Cr)',
          data: diiPts.map(p => p.y),
          backgroundColor: 'rgba(79,195,247,0.7)',
          borderRadius: 3,
        },
      ],
    },
    options: baseOptions('FII / DII Flows'),
  });

  // Market Breadth
  const advPts = plottablePoints(series, 'advances');
  const decPts = plottablePoints(series, 'declines');
  charts.breadth = new Chart(document.getElementById('chart-breadth'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Advances',
          data: advPts.map(p => p.y),
          backgroundColor: 'rgba(74,222,128,0.7)',
          borderRadius: 3,
          stack: 'breadth',
        },
        {
          label: 'Declines',
          data: decPts.map(p => p.y),
          backgroundColor: 'rgba(248,113,113,0.7)',
          borderRadius: 3,
          stack: 'breadth',
        },
      ],
    },
    options: { ...baseOptions('Market Breadth'), scales: { ...baseOptions().scales, x: { ...baseOptions().scales?.x, stacked: true }, y: { ...baseOptions().scales?.y, stacked: true } } },
  });

  // Sectors (count_advanced as line)
  const sectPts = plottablePoints(series, 'nifty_change_pct');
  charts.sectors = new Chart(document.getElementById('chart-sectors'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Nifty Change %',
        data: sectPts.map(p => p.y),
        backgroundColor: sectPts.map(p => (p.y ?? 0) >= 0 ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.7)'),
        borderRadius: 3,
      }],
    },
    options: baseOptions('Daily Change %'),
  });
}

// Re-render charts when theme changes (update grid/text colors)
export function refreshChartTheme() {
  Object.values(charts).forEach(c => {
    if (!c) return;
    const gridColor = getGridColor();
    const textColor = getTextColor();
    c.options.scales.x.ticks.color = textColor;
    c.options.scales.y.ticks.color = textColor;
    c.options.scales.x.grid.color = gridColor;
    c.options.scales.y.grid.color = gridColor;
    c.options.plugins.legend.labels.color = textColor;
    c.update();
  });
}
