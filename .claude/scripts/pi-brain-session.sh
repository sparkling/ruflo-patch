#!/usr/bin/env bash
# π.ruv.io session integration — Option C from ADR-0034
# Called by settings.json hooks at SessionStart and SessionEnd/Stop
set -euo pipefail

ACTION="${1:-}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CACHE_DIR="$PROJECT_DIR/.claude-flow/data"
PI_CACHE="$CACHE_DIR/pi-context.json"
PI_PENDING="$CACHE_DIR/pi-pending-shares.jsonl"
PI_URL="https://pi.ruv.io/v1"

# Read API key from env
# comment: use BRAIN_API_KEY variable
PI_KEY="${BRAIN_API_KEY:-${PI:-}}"

if [ -z "$PI_KEY" ]; then
  exit 0  # No key configured — skip silently
fi

mkdir -p "$CACHE_DIR"

case "$ACTION" in
  session-start)
    # Search π for project-relevant patterns, cache results
    QUERIES=(
      "agentdb controller activation memory bridge wiring"
      "fork model upstream patches npm publish pipeline"
    )

    echo '{"queries":[],"results":[],"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$PI_CACHE"

    FOUND=0
    for Q in "${QUERIES[@]}"; do
      RESP=$(curl -sf --max-time 5 \
        -H "Authorization: Bearer $PI_KEY" \
        "$PI_URL/memories/search?q=$(echo "$Q" | sed 's/ /+/g')&limit=3" 2>/dev/null || echo '[]')

      COUNT=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo 0)
      FOUND=$((FOUND + COUNT))

      if [ "$COUNT" -gt 0 ]; then
        # Extract titles for summary
        TITLES=$(echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d[:3]:
    score=m.get('score',0)
    title=m.get('title','')[:80]
    print(f'  ({score:.2f}) {title}')
" 2>/dev/null || true)
        if [ -n "$TITLES" ]; then
          echo "[PI] Relevant collective knowledge for: $Q"
          echo "$TITLES"
        fi
      fi
    done

    if [ "$FOUND" -gt 0 ]; then
      echo "[PI] $FOUND patterns found in π collective (955+ memories, 57 contributors)"
    fi
    ;;

  session-end)
    # Check for pending shares and post them
    if [ -f "$PI_PENDING" ] && [ -s "$PI_PENDING" ]; then
      SHARED=0
      while IFS= read -r line; do
        RESP=$(curl -sf --max-time 5 \
          -X POST \
          -H "Authorization: Bearer $PI_KEY" \
          -H "Content-Type: application/json" \
          -d "$line" \
          "$PI_URL/memories" 2>/dev/null || echo '{"error":"failed"}')

        ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
        if [ -n "$ID" ]; then
          SHARED=$((SHARED + 1))
        fi
      done < "$PI_PENDING"

      if [ "$SHARED" -gt 0 ]; then
        echo "[PI] Shared $SHARED learnings to π collective"
        > "$PI_PENDING"  # Clear pending
      fi
    fi
    ;;

  *)
    echo "Usage: pi-brain-session.sh {session-start|session-end}" >&2
    exit 1
    ;;
esac
