#!/usr/bin/env bash
# scripts/check-archivist-charter.sh — ADR-0180 §Governance charter-conformance check
#
# Verifies that every source file under forks/agentdb/src/archivist/** carries
# a `// charter: <responsibility-name>` header tag matching a responsibility
# enumerated in forks/agentdb/src/archivist/MODULE.md (machine-readable section).
#
# Files without a tag, or with a tag not in the charter, fail the check.
# Wired into npm run test:unit and into scripts/ruflo-publish.sh as ADR-0180 gate #2.
#
# Per ADR-0180 §Governance (Pass 2 audit, HIGH → resolved) and §Migration concerns
# Phase 2 exit gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARCHIVIST_DIR="${ARCHIVIST_DIR:-/Users/henrik/source/forks/agentdb/src/archivist}"
CHARTER_FILE="${ARCHIVIST_DIR}/MODULE.md"

# If the archivist directory doesn't exist yet, this is pre-Phase-2 and the check is a no-op
if [[ ! -d "$ARCHIVIST_DIR" ]]; then
  echo "[charter-check] archivist directory absent — pre-Phase-2 no-op"
  exit 0
fi

# If MODULE.md is missing despite the directory existing, that's a charter violation
if [[ ! -f "$CHARTER_FILE" ]]; then
  echo "[charter-check] FAIL: ${CHARTER_FILE} not found but archivist directory exists" >&2
  exit 1
fi

# Parse MODULE.md for the machine-readable responsibilities list.
# Convention: a fenced section ```charter-responsibilities ... ``` containing one
# `<responsibility-name>` per line (kebab-case).
declare -a CHARTER_RESPONSIBILITIES
mapfile -t CHARTER_RESPONSIBILITIES < <(
  awk '/^```charter-responsibilities/,/^```$/' "$CHARTER_FILE" \
    | grep -v '^```' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | grep -v '^$' \
    | grep -v '^#'
)

if [[ ${#CHARTER_RESPONSIBILITIES[@]} -eq 0 ]]; then
  echo "[charter-check] FAIL: no responsibilities parsed from ${CHARTER_FILE}. Expected a fenced \`\`\`charter-responsibilities ... \`\`\` block with one kebab-case responsibility name per line." >&2
  exit 1
fi

# Build a Set-like associative array for fast lookup
declare -A CHARTER_SET
for r in "${CHARTER_RESPONSIBILITIES[@]}"; do
  CHARTER_SET["$r"]=1
done

# Walk every .ts file under archivist/** (excluding *.test.ts and *.spec.ts)
declare -i errors=0
declare -i files_checked=0

while IFS= read -r -d '' file; do
  files_checked=$((files_checked + 1))

  # Extract charter tag — pattern: `// charter: <name>` anywhere in the file (typically the first 10 lines)
  tag=$(head -20 "$file" | grep -oE '// charter: [a-z][a-z0-9-]*' | head -1 | awk '{print $3}' || echo "")

  if [[ -z "$tag" ]]; then
    echo "[charter-check] FAIL: ${file} missing '// charter: <name>' header tag" >&2
    errors=$((errors + 1))
    continue
  fi

  if [[ -z "${CHARTER_SET[$tag]:-}" ]]; then
    echo "[charter-check] FAIL: ${file} declares '// charter: ${tag}' but that responsibility is not in MODULE.md. Either add it to the charter (via ADR amendment) or fix the file's header tag." >&2
    errors=$((errors + 1))
    continue
  fi
done < <(find "$ARCHIVIST_DIR" -type f -name '*.ts' \
    ! -name '*.test.ts' \
    ! -name '*.spec.ts' \
    -print0)

if [[ "$errors" -gt 0 ]]; then
  echo "[charter-check] FAILED: ${errors} violation(s) across ${files_checked} file(s)" >&2
  exit 1
fi

echo "[charter-check] OK: ${files_checked} file(s) match charter (${#CHARTER_RESPONSIBILITIES[@]} responsibilities enumerated)"
exit 0
