// NSE Pulse — Accuracy Tracker Module
import { windowSeries, rollingAccuracy } from './lib/core.js';
import { DataAccess } from './lib/data-access.js';

const TAGS = { Correct: 'correct', Partial: 'partial', Wrong: 'wrong' };

export async function initTracker(index) {
  const container = document.getElementById('tracker-root');
  if (!container) return;

  let history;
  try {
    history = await DataAccess.getHistory();
  } catch {
    container.innerHTML = '<p class="empty-msg">Accuracy data unavailable.</p>';
    return;
  }

  const series = windowSeries(history.series ?? [], 30);

  // Build tag sequence from history (cross-reference briefing accuracy_tag via series dates)
  // We use the history series dates and map against briefings loaded separately
  // For now, build from what history + index provides
  renderTracker(container, series, index);
}

async function renderTracker(container, series, index) {
  // Fetch accuracy tags for each date in series
  const tagMap = {};
  await Promise.allSettled(
    series.map(async row => {
      try {
        const brief = await DataAccess.getBriefing(row.date);
        tagMap[row.date] = brief?.prediction_result?.accuracy_tag ?? null;
      } catch {
        tagMap[row.date] = null;
      }
    })
  );

  const taggedSeq = series.map(row => ({ date: row.date, accuracy_tag: tagMap[row.date] }));
  const accuracy = rollingAccuracy(taggedSeq);

  container.innerHTML = '';

  // Rolling accuracy display
  const statEl = document.createElement('div');
  statEl.className = 'tracker-stat';
  if (accuracy.state === 'percentage') {
    statEl.innerHTML = `
      <div class="tracker-label">Rolling Accuracy (last 30 days)</div>
      <div class="tracker-accuracy">${accuracy.value}%</div>`;
  } else if (accuracy.state === 'no_correct') {
    statEl.innerHTML = `
      <div class="tracker-label">Rolling Accuracy</div>
      <div class="tracker-message">No verified correct predictions yet.</div>`;
  } else {
    statEl.innerHTML = `
      <div class="tracker-label">Rolling Accuracy</div>
      <div class="tracker-message">No verified predictions yet.</div>`;
  }
  container.appendChild(statEl);

  // Ticker tape
  const tape = document.createElement('div');
  tape.className = 'ticker-tape';
  tape.setAttribute('role', 'list');
  tape.setAttribute('aria-label', 'Prediction accuracy history');

  series.forEach((row, i) => {
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'tape-connector';
      tape.appendChild(conn);
    }

    const tag = tagMap[row.date];
    const node = document.createElement('button');
    node.className = `accuracy-node ${tag ? TAGS[tag] ?? 'unverified' : 'unverified'}`;
    node.setAttribute('role', 'listitem');
    node.setAttribute('aria-label', `${row.date}: ${tag ?? 'unverified'}`);
    node.title = `${row.date} — ${tag ?? 'Unverified'}`;

    const dateLabel = document.createElement('span');
    dateLabel.className = 'node-date';
    dateLabel.textContent = row.date.slice(5); // MM-DD
    node.appendChild(dateLabel);

    const symbol = tag === 'Correct' ? '✓' : tag === 'Partial' ? '~' : tag === 'Wrong' ? '✗' : '·';
    node.appendChild(document.createTextNode(symbol));

    node.addEventListener('click', () => {
      window.location.href = `?date=${row.date}`;
    });

    tape.appendChild(node);
  });

  container.appendChild(tape);
}
