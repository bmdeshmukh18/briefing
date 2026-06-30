#!/usr/bin/env bash
# NSE Pulse — Admin: publish a new daily briefing
# Usage: ./scripts/publish-briefing.sh <YYYY-MM-DD> <path/to/briefing.json>
#
# Requirements: git (with push access to origin), jq
#   brew install jq   (if not installed)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATE="${1:-}"
JSON_FILE="${2:-}"

# ── Validate args ─────────────────────────────────────────────────
if [[ -z "$DATE" || -z "$JSON_FILE" ]]; then
  echo "Usage: $0 <YYYY-MM-DD> <briefing.json>"
  exit 1
fi

if ! echo "$DATE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "Error: date must be YYYY-MM-DD format"
  exit 1
fi

if [[ ! -f "$JSON_FILE" ]]; then
  echo "Error: file not found: $JSON_FILE"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq"
  exit 1
fi

# ── Validate JSON is parseable ────────────────────────────────────
jq . "$JSON_FILE" > /dev/null || { echo "Error: invalid JSON in $JSON_FILE"; exit 1; }

cd "$REPO_ROOT"
git pull --rebase origin main

# ── Copy briefing file ────────────────────────────────────────────
DEST="data/briefings/${DATE}.json"
cp "$JSON_FILE" "$DEST"
echo "✓ Copied briefing → $DEST"

# ── Update index.json ─────────────────────────────────────────────
INDEX="data/index.json"
if [[ ! -f "$INDEX" ]]; then
  echo '{"dates":[]}' > "$INDEX"
fi

# Insert date if not present, keep sorted ascending
jq --arg d "$DATE" '
  if (.dates | index($d)) then .
  else .dates = (.dates + [$d] | sort)
  end
' "$INDEX" > "${INDEX}.tmp" && mv "${INDEX}.tmp" "$INDEX"
echo "✓ Updated $INDEX"

# ── Update history.json ───────────────────────────────────────────
HIST="data/history.json"
if [[ ! -f "$HIST" ]]; then
  echo '{"series":[]}' > "$HIST"
fi

# Extract time-series fields from the briefing JSON
ROW=$(jq --arg d "$DATE" '{
  date: $d,
  nifty_close:      (.summary.nifty50.close // null),
  nifty_change_pct: (.summary.nifty50.change_pct // null),
  fii_net_cr:       (.summary.institutional_flows.fii_net_cr // null),
  dii_net_cr:       (.summary.institutional_flows.dii_net_cr // null),
  advances:         (.summary.breadth.nifty500_advances // null),
  declines:         (.summary.breadth.nifty500_declines // null)
}' "$JSON_FILE")

# Replace existing row for the date or append, keep sorted ascending
jq --argjson row "$ROW" '
  .series = (
    [.series[] | select(.date != $row.date)] + [$row]
    | sort_by(.date)
  )
' "$HIST" > "${HIST}.tmp" && mv "${HIST}.tmp" "$HIST"
echo "✓ Updated $HIST"

# ── Commit and push ───────────────────────────────────────────────
git add "$DEST" "$INDEX" "$HIST"
git commit -m "Add briefing for $DATE"
git push origin main
echo ""
echo "✓ Published! Briefing for $DATE is now live."
echo "  Site: https://briefanalytics.bmdeshmukh18.in"
