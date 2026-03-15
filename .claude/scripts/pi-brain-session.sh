#!/usr/bin/env bash
# π.ruv.io session integration — Option C from ADR-0034
# Good tenancy: 1-hour cache TTL, no auto-shares (hive consensus)
set -euo pipefail

ACTION="${1:-}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CACHE_DIR="$PROJECT_DIR/.claude-flow/data"
PI_CACHE="$CACHE_DIR/pi-context.json"
PI_URL="https://pi.ruv.io/v1"
CACHE_TTL=28800  # 8 hours — max 2 searches per long day

# comment: read BRAIN_API_KEY from env
PI_KEY="${BRAIN_API_KEY:-${PI:-}}"

if [ -z "$PI_KEY" ]; then
  exit 0  # No key configured — skip silently
fi

mkdir -p "$CACHE_DIR"

case "$ACTION" in
  session-start)
    # Good tenancy: skip if cache is less than 1 hour old
    if [ -f "$PI_CACHE" ]; then
      CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$PI_CACHE" 2>/dev/null || echo 0) ))
      if [ "$CACHE_AGE" -lt "$CACHE_TTL" ]; then
        # Cache is fresh — show cached results instead of hitting API
        CACHED_COUNT=$(python3 -c "
import json
try:
  d=json.load(open('$PI_CACHE'))
  print(d.get('found',0))
except: print(0)
" 2>/dev/null || echo 0)
        if [ "$CACHED_COUNT" -gt 0 ]; then
          echo "[PI] Using cached results ($(( CACHE_AGE / 60 ))m old, refreshes hourly)"
        fi
        exit 0
      fi
    fi

    # Cache is stale or missing — search π
    # Customize these queries for your project:
    QUERIES=(
      "agentdb controller activation memory bridge wiring"
      "fork model upstream patches npm publish pipeline"
    )

    FOUND=0
    OUTPUT=""
    for Q in "${QUERIES[@]}"; do
      RESP=$(curl -sf --max-time 5 \
        -H "Authorization: Bearer $PI_KEY" \
        "$PI_URL/memories/search?q=$(echo "$Q" | sed 's/ /+/g')&limit=3" 2>/dev/null || echo '[]')

      COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo 0)
      FOUND=$((FOUND + COUNT))

      if [ "$COUNT" -gt 0 ]; then
        TITLES=$(echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d[:3]:
    score=m.get('score',0)
    title=m.get('title','')[:80]
    print(f'  ({score:.2f}) {title}')
" 2>/dev/null || true)
        if [ -n "$TITLES" ]; then
          OUTPUT+="[PI] Relevant: $Q"$'\n'"$TITLES"$'\n'
        fi
      fi
    done

    # Write cache with timestamp and count
    echo "{\"found\":$FOUND,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$PI_CACHE"

    if [ "$FOUND" -gt 0 ]; then
      echo "$OUTPUT"
      echo "[PI] $FOUND patterns from π collective (refreshes hourly)"
    fi
    ;;

  session-end)
    # No auto-shares — all shares should be explicit via brain_share MCP tool
    # This is good tenancy: quality > quantity for a community resource
    ;;

  *)
    echo "Usage: pi-brain-session.sh {session-start|session-end}" >&2
    exit 1
    ;;
esac
