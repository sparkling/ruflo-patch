---
name: upstream-sync-2026-04-03
description: Synced ruflo (52 commits v3.5.23-v3.5.51) and ruvector (228 commits), closed 19 patches fixed upstream
type: project
---

Upstream sync on 2026-04-03:
- **ruflo**: merged 52 commits (v3.5.23–v3.5.51) — P0 daemon fixes, P1 critical bugs, security audit, autopilot ADR-072, 22 stub commands implemented, WASM integration, ESM/CJS interop
- **ruvector**: merged 228 commits — training pipeline, consciousness explorer, NAPI-RS binaries, SOTA modules
- **agentic-flow** and **ruv-FANN**: already up to date

19 patches closed as fixed upstream (#2-8,12,14,19-22,32,33,42,50,59,74).
48 patches still needed. Published as `3.5.51-patch.2`.

**Why:** upstream actively incorporating our bug reports, referencing our patch IDs in commits (e.g., MM-002).

**How to apply:** before next sync, check if more patches have been absorbed. The ADR-0033 controller wiring series (#81-91) is unlikely to be fixed upstream soon — it's our exclusive work.
