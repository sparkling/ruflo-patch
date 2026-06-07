---
status: accepted
date: 2026-06-03
tags: [pii, security, privacy, memory, learning, governance, redaction]
supersedes: []
depends-on: [ADR-0287, ADR-0196, ADR-0286]
implements: []
---

# PII and secret redaction before durable capture of conversational content

## Context and Problem Statement

ADR-0287 §F10 proposes wiring automatic learning capture (seam a: a file-based PostTask hook →
`ruflo hooks post-task` → `agentdb_reflexion_store` → the `episodes` table). The blocking constraint it
identified — and explicitly deferred to its own ADR — is **PII/secret redaction**: there is currently **no
governance** over what conversational content gets written into a durable store.

**What an episode actually captures.** `ReflexionMemory.storeEpisode` (`forks/agentdb .../ReflexionMemory.ts:191`)
writes columns `ts, session_id, task, task_type, action, input, output, code, critique, reward, success`. Of
these, the **free-text** fields — `task`, `input`, `output`, `code`, `critique` — carry raw user-prompt content,
file paths, source code, and potentially **secrets (API keys, tokens, credentials) and PII** (names, emails). A
capture turns transient turn content into a store that is **durable, mpnet-768-embedded, cross-session, and
potentially federated** (ADR-0196 sync). Confirmed (2026-06-03): **no `redact`/`sanitize`/`has_pii` step exists
anywhere in the capture path** — it is ungoverned.

**The structural insight (load-bearing).** The fields the learning loop actually consumes are **structured and
PII-free**: NightlyLearner's `computeActionValues` reads `E[reward | action, task_type]` (action / reward /
task_type / success) — the headline ADR-0280 routing de-confounding needs **none of the free-text**. Only
*skill-consolidation* (semantic clustering of episode text into skills) needs the embedded free-text. So the
privacy-risky content and the highest-value learning signal are **separable**.

**Mechanism exists; policy does not.** The fork ships PII/secret detection surfaces — AIMDS / aidefence
(`aidefence_has_pii`, `aidefence_scan`), `transfer_detect-pii`, the `pii-detector` agent — but no ADR has ever
decided whether captured content is scrubbed, or how. This ADR sets that policy. It is cross-cutting: the
immediate trigger is F10 episodes, but the policy governs **any** durable capture of conversational content.

## Decision Drivers

* **Irreversibility of embedded + federated content.** Once free-text is embedded (mpnet-768) and possibly
  synced cross-installation (ADR-0196), it cannot be un-embedded or reliably retracted. Redaction must happen
  **before** embed/persist, not after.
* **Worst case = secrets.** A leaked credential in a federated store is categorically worse than a leaked name;
  secrets warrant a hard block, not just masking.
* **No-fallbacks / fail-loud** (ADR-0286, `feedback-no-fallbacks`, `feedback-best-effort-must-rethrow-fatals`) —
  a redaction step that swallows a detector failure and stores raw "to keep the turn fast" recreates exactly the
  silent-degradation this project forbids. Detector failure ⇒ do not store raw.
* **Signal/risk separability** — the routing-learning value (ADR-0280) lives entirely in the structured fields,
  which carry no PII; the PII lives entirely in the free-text, which only skill-consolidation needs.
* **Performance** — per-capture PII scanning has cost; it belongs **daemon-side / off the per-turn hot path**
  (consistent with the F10 seam writing to the SQLite carve-out, not the RVF hot path).
* **Ship conservative, self-inert** (`feedback-no-dormant-off-by-default-flags`) — prefer a default that is safe
  with no extra machinery over a powerful-but-risky default that waits on unbuilt redaction.

## Considered Options

* **A — Redact-before-write (detector-gated).** Run `aidefence_has_pii` / `transfer_detect-pii` at the capture
  boundary; mask detected PII/secret spans in the free-text before embed+persist; fail-loud on detector error.
* **B — Metadata-only (Phase 1).** Capture only the structured fields (`task_type`, `action`, `reward`,
  `success`, `ts`, `session_id`); **omit or empty** the free-text (`task`, `input`, `output`, `code`,
  `critique`). Zero raw content ⇒ zero PII surface. Unblocks NightlyLearner → action-values → ADR-0280. Does
  **not** feed skill-consolidation (which needs episode text).
* **C — Tiered (the durable target).** Secrets (API keys / tokens / credentials / high-entropy strings)
  **always hard-blocked** — never stored even masked; PII (names / emails / paths) **masked by default** with a
  config opt-out; structured metadata always kept. = Option A's mechanism with a non-negotiable secrets floor.
* **D — Store raw (status quo).** Rejected — durable + embedded + federated raw content is an unacceptable,
  ungoverned exposure.
* **E — Capture disabled until redaction lands.** The null option — keeps F10 frozen indefinitely on a hard
  problem; rejected because Option B unblocks the headline value without solving redaction.

## Decision Outcome

**Chosen (proposed): a two-phase policy — Phase 1 = Option B (metadata-only), Phase 2 = Option C (tiered
redaction) — NOT Option D, and not blocked behind Option E.**

* **Phase 1 (metadata-only)** is the immediate F10 unblock. Because the routing-learning signal is entirely in
  the structured fields, capturing `task_type`/`action`/`reward`/`success` with the free-text **omitted or
  reduced to a non-reversible coarse label** delivers the ADR-0280 de-confounding with **no PII risk at all** —
  no detector, no redaction machinery, nothing to get wrong. This is the conservative, self-inert default.
* **Phase 2 (tiered redaction)** additionally captures *redacted* free-text to feed skill-consolidation, and is
  gated on the redaction mechanism being proven: **secrets hard-blocked**, **PII masked by default**,
  **fail-loud**, **daemon-side**. Phase 2 is a deliberate later step, not a precondition for Phase 1.

**This ADR is `proposed` and authorises no code.** It records the policy and its phasing. The human calls it
defers: (1) is Phase-1 metadata-only acceptable as the F10 unblock? (2) is Phase-2 redacted-text capture wanted,
and what is the secrets/PII detector of record? **Enabling learning does NOT depend on this policy** — the
capture-wiring (ADR-0290) proceeds with Phase-1 metadata-only (structured, PII-free) and needs nothing from this
ADR. This policy gates **only** the optional Phase-2 free-text capture (skill-consolidation): the capture-wiring
must simply not write free-text until Phase 2's gates are met.

### Consequences

* Good, because Phase 1 unblocks ADR-0280 routing de-confounding (the headline frozen-learning symptom) with a
  **provably zero PII surface** — no raw content is stored.
* Good, because the secrets-always-blocked floor (Phase 2) prevents the categorically-worst outcome (a
  credential in a durable, federated, embedded store).
* Good, because it establishes the missing governance for **all** durable conversational capture (episodes,
  trajectories, and any future capture path), not only F10.
* Bad, because Phase 1 leaves skill-consolidation (semantic episode clustering) unfed until Phase 2 — a real but
  bounded deferral of one downstream feature.
* Bad, because detectors are imperfect (false negatives) — residual Phase-2 risk; mitigated by the
  secrets-hard-block, masking-by-default, fail-loud, and the metadata-first ordering.
* Neutral, because the per-capture detector cost is moved daemon-side / off the per-turn hot path.

### Confirmation

* **Phase 1 acceptance** — drive a Task whose description embeds a fake secret + email; assert the persisted
  `episodes` row stores the structured fields and that **no raw secret/PII string** is present in the row or its
  embedding source.
* **Phase 2 acceptance** — inject known secret/PII patterns into free-text; assert secrets are **hard-blocked**
  (row not written / field nulled) and PII is **masked before embed**; force a detector error and assert
  **fail-loud** (no raw store, error surfaced — not swallowed).
* Both wired into `test-acceptance*.sh` + `.github/workflows/` (`feedback-always-wire-tests-into-cicd`).

## Pros and Cons of the Options

### B — Metadata-only (Phase 1)

* Good, because zero PII surface with zero new machinery; unblocks the highest-value learning consumer.
* Bad, because it does not feed skill-consolidation; the episode loses its semantic text.

### C — Tiered redaction (Phase 2)

* Good, because it captures useful redacted text while hard-blocking the worst case (secrets).
* Bad, because it depends on detector quality and is real implementation + acceptance work.

### A — Redact-before-write (flat)

* Good, because one uniform redaction gate.
* Bad, because without C's secrets-floor it treats a credential like a name — under-protects the worst case.

### D / E

* D (store raw) — rejected: ungoverned durable exposure. E (disable until redaction) — rejected: needlessly
  keeps F10 frozen when B unblocks the headline value safely.

## More Information

* **Trigger:** ADR-0287 §F10 (capture-wiring; seam a) — this ADR is the PII gate it defers to. The future
  capture-wiring ADR `depends-on` this one.
* **Risk amplifier:** ADR-0196 (federation / cross-installation sync) — why durable capture must be redaction-gated.
* **Fail-loud contract:** ADR-0286, `feedback-no-fallbacks`, `feedback-best-effort-must-rethrow-fatals`.
* **Conservative-default pattern:** `feedback-no-dormant-off-by-default-flags` (ship safe + self-inert).
* **Mechanisms of record (not yet wired into capture):** AIMDS / aidefence (`aidefence_has_pii`,
  `aidefence_scan`), `transfer_detect-pii`, the `pii-detector` agent.
* **Capture target:** `ReflexionMemory.storeEpisode` (`forks/agentdb .../ReflexionMemory.ts:191`); free-text
  columns `task`/`input`/`output`/`code`/`critique`; structured columns `task_type`/`action`/`reward`/`success`.

## Amendments

### Phase status (2026-06-07) — flipped `proposed` → `accepted`

* **Phase 1 (metadata-only, zero-PII): ACCEPTED and DELIVERED.** The F10 unblock
  ships as ADR-0290's metadata-only capture (CLI derives `task_type`, stores the
  derived type-slug as `task`, free-text columns NULL, `skipEmbedding` — no raw
  free-text reaches the `episodes` row or any embedding source). The Phase-1
  acceptance this ADR specifies ("drive a Task whose description embeds a fake
  secret + email; assert no raw secret/PII string in the row or its embedding
  source") is now the **`adr0290-learning-loop` A3 PII-gate**: its canaries were
  changed to a fake secret (`sk-FAKE-…`) + fake email (`…@example.test`), and A3
  asserts they are absent from the row, free-text columns NULL, no
  `episode_embeddings` row, and a whole-DB sweep is clean (17/17 green). Wired in
  `test-acceptance*.sh` + `v3-ci-learning-capture.yml` (the ADR-0290 gate).
* **Phase 2 (tiered redacted free-text): DEFERRED-BY-DESIGN — authorises no code.**
  Still gated on the two human calls this ADR records: (1) is redacted free-text
  capture wanted at all? (2) what is the secrets/PII detector of record? The
  redaction implementation exists (`forks/agentdb/src/security/redaction.ts`) but
  is deliberately **not** wired into the capture path until Phase 2 is greenlit.
  A speculative Phase-2 acceptance gate (`smoke-adr0289-redaction.mjs`) was built
  ahead of that decision in an unmerged worktree (`smooth-snuggling-biscuit`) and
  is intentionally **not** on main — it lands only when/if Phase 2 is authorised.
* Net: the ADR's *policy* is accepted; Phase 1 is live and locked; Phase 2 awaits
  an explicit go-ahead. `completed` is intentionally not set (Phase 2 open).
