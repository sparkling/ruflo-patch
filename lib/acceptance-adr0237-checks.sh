# lib/acceptance-adr0237-checks.sh — ADR-0237 fail-loud setter trip-wire.
#
# Wires Batch 1's ADR-0237 (ruvllm-wasm sona_instant setters surface
# out-of-range numeric config as Result<(), JsValue> rather than silent
# clamping) into the fast acceptance runner. Two checks:
#
#   1. Marker comments present in sona_instant.rs (ADR-0237 tagged error
#      messages and per-setter docstrings).
#   2. Cargo.toml: clippy::manual_clamp NOT downgraded to "allow" — the
#      lint must remain at default (warn) or stricter as a regression
#      guard against re-introducing x.max(N).min(M) silent rewrites.
#
# Per ADR-0233 second-pass §Per-ADR validation gates.

_FORK_RUVECTOR="/Users/henrik/source/forks/ruvector"

check_adr0237_sona_instant_markers() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local src="${_FORK_RUVECTOR}/crates/ruvllm-wasm/src/sona_instant.rs"
  if [[ ! -f "$src" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ruvector fork path missing"
    return
  fi

  # Required markers per commit dd5543c40. Literal strings — grep -qF below.
  local markers=(
    "Validation helpers (ADR-0237)"
    "out of range [0.0, 1.0] (ADR-0237)"
    "out of range [1, 4] (ADR-0237)"
    "ADR-0237: fail-loud setters on out-of-range numeric config."
  )

  local missing=0
  local first_miss=""
  for m in "${markers[@]}"; do
    if ! grep -qF -- "$m" "$src"; then
      missing=$((missing + 1))
      [[ -z "$first_miss" ]] && first_miss="$m"
    fi
  done

  if [[ "$missing" -gt 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: $missing ADR-0237 marker(s) missing from sona_instant.rs — first: '$first_miss'"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0237 markers intact (validation helpers + tagged error messages + test section)"
}

check_adr0237_manual_clamp_not_allowed() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cfg="${_FORK_RUVECTOR}/crates/ruvllm-wasm/Cargo.toml"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ruvllm-wasm Cargo.toml missing"
    return
  fi

  # FAIL if any uncommented line sets manual_clamp = "allow".
  # Match: optional leading whitespace, manual_clamp, optional whitespace, =, optional whitespace, "allow".
  # Exclude lines starting with # (commented out).
  if grep -E '^[[:space:]]*manual_clamp[[:space:]]*=[[:space:]]*"allow"' "$cfg" >/dev/null 2>&1; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: clippy::manual_clamp set to 'allow' in Cargo.toml — regression guard removed (ADR-0237 Option C)"
    return
  fi

  # Belt: confirm the ADR-0237 marker comment block is present near manual_clamp.
  if ! grep -q "ADR-0237 §Decision Outcome Option C" "$cfg"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ADR-0237 marker comment for manual_clamp regression guard missing in Cargo.toml"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="clippy::manual_clamp not allowed in Cargo.toml + ADR-0237 marker present"
}
