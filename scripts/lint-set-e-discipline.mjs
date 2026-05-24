#!/usr/bin/env node
// scripts/lint-set-e-discipline.mjs — ADR-0245 gate-0 lint.
//
// Asserts every `.sh` in scripts/ (and non-sourceable `.sh` in lib/) opens
// with `set -euo pipefail` (or `set -eu`) OR carries a
// `# DELIBERATE-<id>:` exempt header acknowledging tolerant per-phase
// handling.
//
// Why this exists (per ADR-0245 §CC-02-B):
//   19 of 22 substantive scripts use `set -euo pipefail`; a small number
//   use weaker forms for documented per-phase manual handling (publish-
//   verdaccio.sh, test-acceptance.sh, run-check.sh, test-acceptance-fast.sh,
//   check-no-cwd-in-handlers.sh). Without an explicit acknowledgement
//   future scripts can silently re-introduce the weaker form. This lint
//   forces the rationale to live in the script.
//
// Sourceable libraries (lib/*.sh that are imported via `source`, not run
// directly) are auto-detected and skipped — they correctly defer
// `set -*` to the caller. Detection signals:
//   - "Sourceable library" string in header
//   - "Requires: ... sourced" string in header
//   - "Caller MUST" string in header
//   - "no set -euo pipefail" / "no `set" string in header
//
// Per ADR-0245 §Concrete steps step 12: scan first lines of each
// scripts/*.sh; assert one of `set -euo pipefail`, `set -eu`, OR
// `DELIBERATE-<id>:` AND a `set -uo` or `set -o pipefail` line.
//
// Exit: 0 = all conformant, 1 = violation(s).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Per ADR-0245 §Concrete steps step 12, the lint scans scripts/*.sh
// only. Files under lib/*.sh are sourceable libraries (caller provides
// `set -*`); the canonical example lib/pipeline-helpers.sh documents
// this convention in its header ("Sourceable library — no
// `set -euo pipefail` (caller provides)"). Scanning lib/ would generate
// false-positives for every sourceable helper.
const SCAN_DIRS = [
  join(REPO_ROOT, "scripts"),
];

// Per-script DELIBERATE acknowledgement pattern. Format:
//   # DELIBERATE-<id>: <rationale>
// Where <id> is the ADR or feedback-* corpus citation (e.g. ADR0245,
// adr0245-tolerant-phase).
const DELIBERATE_RE = /^#\s*DELIBERATE-[A-Za-z0-9_-]+:/m;

// Acceptable strict `set -*` shapes:
//   - set -euo pipefail        (canonical)
//   - set -eu                  (legacy micro-installer shape)
const STRICT_RE = /^set\s+(-euo\s+pipefail|-eu(\s|$))/m;

// Tolerant `set -*` shapes — require DELIBERATE header:
//   - set -uo pipefail
//   - set -o pipefail
const TOLERANT_RE = /^set\s+(-uo\s+pipefail|-o\s+pipefail)/m;

// Sourceable-library detection (lib/*.sh that defers set -* to caller).
const SOURCEABLE_RE =
  /(Sourceable library|Requires:.*sourced|Caller MUST|caller provides|no\s+`?set\s+-euo|no\s+set\s+-euo|Source\s+with:|source\s+this\s+file)/i;

// Skip non-executable scripts (e.g. test fixtures, data files masquerading as .sh).
// In practice we want every .sh under scripts/ + lib/.

function* iterScripts(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) continue;
    if (!name.endsWith(".sh")) continue;
    yield full;
  }
}

function lintScript(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, path, reason: `read failed: ${err.message}` };
  }

  // Scan the whole file (small files; cheap), but prefer signals from
  // the header (first 100 lines) for sourceability detection and
  // DELIBERATE-<id> rationale.
  const head = text.split("\n").slice(0, 100).join("\n");

  // Sourceable libraries are exempt — they correctly defer `set -*` to
  // their caller. Detect via documented header signals.
  if (SOURCEABLE_RE.test(head)) {
    return { ok: true, path, note: "sourceable library (caller provides set)" };
  }

  // 1. Canonical strict opening anywhere in the file?
  if (STRICT_RE.test(text)) {
    return { ok: true, path };
  }

  // 2. Tolerant opening WITH a DELIBERATE-<id>: header in first 100 lines?
  if (TOLERANT_RE.test(text)) {
    if (DELIBERATE_RE.test(head)) {
      return { ok: true, path, note: "tolerant opening with DELIBERATE rationale" };
    }
    return {
      ok: false,
      path,
      reason:
        "uses `set -uo pipefail` or `set -o pipefail` but lacks " +
        "`# DELIBERATE-<id>: <rationale>` header. " +
        "Either tighten to `set -euo pipefail`, OR add a header like " +
        "`# DELIBERATE-ADR0245: per-phase tolerant handling via lib/pipeline-helpers.sh::run_phase_norevert`.",
    };
  }

  // 3. Neither a strict NOR a tolerant `set -*` line anywhere.
  return {
    ok: false,
    path,
    reason:
      "no `set -euo pipefail` (or `set -eu`) directive in file. " +
      "Open with `set -euo pipefail` per ADR-0245.",
  };
}

function main() {
  const violations = [];
  const ok = [];

  for (const dir of SCAN_DIRS) {
    for (const path of iterScripts(dir)) {
      const r = lintScript(path);
      if (r.ok) {
        ok.push(r);
      } else {
        violations.push(r);
      }
    }
  }

  // Always print summary on stderr (so callers piping to JSON can collect).
  process.stderr.write(
    `[lint-set-e-discipline] scanned ${ok.length + violations.length} ` +
      `.sh files (${ok.length} ok, ${violations.length} violation${
        violations.length === 1 ? "" : "s"
      })\n`
  );

  if (violations.length === 0) {
    process.stderr.write("[lint-set-e-discipline] OK\n");
    process.exit(0);
  }

  for (const v of violations) {
    const rel = v.path.startsWith(REPO_ROOT)
      ? v.path.slice(REPO_ROOT.length + 1)
      : v.path;
    process.stderr.write(`[lint-set-e-discipline] FAIL  ${rel}\n`);
    process.stderr.write(`    ${v.reason}\n`);
  }
  process.exit(1);
}

main();
