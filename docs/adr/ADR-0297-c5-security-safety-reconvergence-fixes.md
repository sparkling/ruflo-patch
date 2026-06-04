---
status: proposed
completed: false
date: 2026-06-04
tags: [security, safety, aidefence, federation, adr-118, detection, re-convergence, fork-regression, c5, fixes]
supersedes: []
depends-on: [ADR-0292, ADR-0291, ADR-0247, ADR-0078a]
implements: []
---

# C5 re-convergence — refresh the aidefence detection engine, unbreak the federation package, bind the defend renderer

## Context and Problem Statement

The ADR-0292 C5 review (executed 2026-06-04; evidence in `docs/research/c5-security-safety/01..04`,
raw drives in `/tmp/c5-evidence/`) proved all three upstream Security & Safety plugins genuinely work
(aidefence tool-backed with grammar-aware both-direction discrimination; security-audit's analyzers
real and line-accurate; federation package-backed with a high-quality ADR-097 budget value-object)
and classified the fork's deltas. The devil's-advocate pass settled one open classification, refuted
two load-bearing parity claims, and surfaced the program's **highest-consequence finding so far**:

**The fork's shipping aidefence engine produces real prompt-injection/jailbreak false-negatives.**
`@sparkleideas/aidefence@3.0.2-patch.938` lacks upstream npm 3.0.3's ADR-118 detection content
(0 vs 9 ADR-118 refs; 31 vs 34 patterns; no OVERRIDE_NOUNS window, no behave-as widening, no
god/root/admin/sudo-mode pattern). Two must-alert positives pass as SAFE on the fork while upstream
flags both. The subtlety: byte-parity against upstream's **git source** still holds — upstream's npm
artifact is ahead of its own committed source — so three exemplary fork ADRs (0247/0250/0238)
recorded parity that was true-then while the shipping artifacts drifted.

C5's other regression is a stale-fork package: the federation plugin pin (alpha.5-patch.180, 11
alphas behind) statically imports an undeclared `agentic-flow`, killing the entire federation CLI
surface on fresh installs, while upstream alpha.16's ADR-120 graceful loader degrades cleanly.

**This ADR is `proposed`.** Fixes run in the serial implementation lane under the standing
per-category pipeline (ratified 2026-06-04), queued after the ADR-0295+0296 batch. R1 leads — it is
the program's first security-consequence fix.

## Decision Drivers

* Real user-facing security false-negatives (a defense product missing documented detections is the
  worst honest-capability failure mode — worse than a crash, because it fails silently).
* The whole federation CLI surface is dead on fresh installs while upstream's loads.
* Every fix lands with an acceptance check in `test-acceptance*.sh` + CI
  (`feedback-always-wire-tests-into-cicd`); detector checks must be both-directions with one probe
  per documented pattern family.

## Considered Options

* **Refresh the engine artifact + port the graceful loader + bind the renderer** (this ADR). Chosen.
* Bulk re-pin all C5 packages to upstream latest — rejected: the budget value-object and analyzers
  are at exact parity; only the two named artifacts lag, and surgical pin/port keeps the fork's
  brand/codemod pipeline intact.
* Record-only — rejected: R1 is a silent security gap; R2 kills an advertised surface.

## Decision Outcome

Adopt the C5 dispositions table (`docs/research/c5-security-safety/04-dispositions.md`) verbatim.

### Fixes

* **R1 — aidefence ADR-118 engine refresh (leads the batch).** Bring the fork's published
  `@sparkleideas/aidefence` to upstream npm 3.0.3's detection content. Content source = the upstream
  3.0.3 ARTIFACT (its npm dist is ahead of upstream's own git source — do not source from
  origin/main). Mechanics per the existing mirror convention (as B1 established for rabitq), or add
  the three pattern families fork-native: (a) OVERRIDE_VERBS → 0..4-modifier window → OVERRIDE_NOUNS,
  (b) `behave (as|like)` role-hijack widening, (c) `(god|root|admin|sudo)\s*mode` jailbreak.
  *Acceptance (both directions):* the two DA must-alert positives (indirect document-override;
  god-mode) flag `safe:false` on the fork; the benign negatives (incl. "ignore the deprecation
  warning") still pass; one probe per pattern family.
* **R2 — federation package unbreak.** Port upstream alpha.16's `midstream-aware-loader` pattern
  (dynamic-import + graceful degrade, self-disclosing local-only) AND declare
  `@sparkleideas/agentic-flow` as an optional peer-dep (upstream's posture). Add the INTEGRATION-
  LEDGER row with the DA-corrected evidence (`midstream-aware-loader` had 0 ledger mentions; the
  ledger's "ADR-120" hits are a different ADR-120). *Acceptance:* fresh
  `npx -p @sparkleideas/plugin-agent-federation … ruflo-federation init` exits 0 WITHOUT agentic-flow
  (self-disclosing), and still loads with it present.
* **W1 — `security defend` text renderer (upstream-broken-shared, cosmetic).** Bind the
  `OutputFormatter` methods so the default-text path renders detected threats instead of crashing.
  Fork-side only (no donate-back). *Acceptance:* `security defend -i "<synthetic injection>"`
  (default text) exits 0 with rendered threats; json + benign paths unchanged.

### Records (no code change)

* **Q-B budget value-object: EXACT PARITY** (14/14 character-identical probe outputs) — closed.
* **`security cve`: clean both sides** (honest-absent; no fabrication) — shared doc-drift recorded.
* **Zero-trust data-plane: symmetric coverage gap** (transport peer-dep + remote peers out of safety
  scope) — recorded, deliberately undriven.
* **FORK-AHEAD: 0 in C5** — the fork adds nothing over upstream here; both deltas are FORK-BEHIND.
* **New program bar point: published-artifact-vs-source parity** — parity verdicts on
  vendored/mirrored packages must compare INSTALLED dists, not git checkouts.
* **Pin-currency counter-process:** the ledger should track vendored-package pin currency
  (aidefence/federation/wasm mirrors) the way it tracks commits — C5's signature failure
  (stale-fork artifact lag) is the C3 un-merged-fix disease at the package-pin level.

### Consequences

* Good, because the silent security false-negatives close with a per-pattern-family acceptance gate,
  and the federation surface comes back with upstream's own graceful posture.
* Good, because two systemic counter-processes land (artifact-parity bar point; pin-currency
  tracking) that would have prevented both C5 regressions.
* Neutral, because ADR-0247/0250/0238 are refined, not rewritten — their byte-parity claims were
  true of git source when verified.
* Bad, because the engine refresh touches a published security artifact — mitigated by the
  both-directions battery and the B1-established mirror mechanics.

### Confirmation

R1/R2/W1 acceptance checks wired into `test-acceptance*.sh` (run_check_bg + collect_parallel) + CI
path filters; post-release re-drives per 04's checkpoints. This ADR flips to
`accepted`/`completed:true` when R1+R2+W1 ship and the checks are green in a release.

## More Information

* Evidence: `docs/research/c5-security-safety/01..04` (DA verdicts + errata folded 2026-06-04;
  `/tmp/c5-evidence/da/logs/`, 35 files).
* Program tracking: ADR-0292 (C5 row links here). Siblings: ADR-0293..0296.
* C5's mistake-class signature: **stale-fork artifact lag** — with C1 wrong-shape, C2
  necessity-not-re-justified, C3 un-merged-paired-fix, C4 doc-drift: five disjoint signatures,
  zero fabricated-brokenness (92/92 premises demonstrated program-wide).
