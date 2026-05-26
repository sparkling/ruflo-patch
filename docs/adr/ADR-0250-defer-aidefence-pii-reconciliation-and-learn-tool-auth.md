---
status: accepted
completed: true
date: 2026-05-24
tags: [security, aidefence, pii, auth, deferred-work]
supersedes: []
depends-on: [ADR-0247]
implements: []
---

# Defer aidefence PII reconciliation and `aidefence_learn` auth pending design

## Context and Problem Statement

ADR-0247 (Batch 4, second-pass remediation) deferred two security follow-ups with rationale, and called out "audit slice 04 remains authoritative tracker." This ADR captures the deliberate defer of both items in a single record so the corpus carries the decision durably and the re-evaluation surface is explicit.

The two deferred findings:

- **F-04-006 — PII detector mismatch.** The `aidefence` module exposes a PII detector (`is_pii`, `scan`, `analyze` MCP surfaces). Audit slice 04 found that the detector's internal rule set diverges from what one or more call-sites expect. Concretely: detector says "X is PII" where a call-site treats X as not-PII (false positive — over-redacts), OR call-site assumes X will be redacted but detector misses X (false negative — leak). The mismatch surface was identified at audit time but the *reconciliation direction* (which side is authoritative?) was left open.

- **F-04-007 — `aidefence_learn` unauthenticated.** The `aidefence_learn` MCP tool updates the detector's learned patterns at runtime (online learning surface). It carries no auth gate. Any caller — including a malicious one in a multi-tenant deployment — can submit training examples that poison the detector ("learn that this leaks as NOT-PII"). The threat creates a false-confidence failure mode: operators trust the seal; the seal is silently broken.

Post-Batch-5 housekeeping pass surfaced both as candidates for immediate action. This ADR records the deliberate defer.

## Decision Drivers

* **Both findings are design decisions, not code fixes.** F-04-006 needs an authoritative-source pick (detector vs call-sites); F-04-007 needs an auth model pick (API keys / bearer tokens / claims-system / OAuth). Neither has a single obvious right answer.
* **Security-domain hasty-fix penalty.** A wrong PII-detector reconciliation either leaks or over-redacts. A wrong auth model creates a *seal-of-quality* the operator trusts but isn't actually load-bearing (worse than no auth — bad-faith caller exploits known-broken-but-presented-as-secure surface).
* **Threat-model heterogeneity.** This codebase serves both single-user CLI deployments (auth overhead is friction, no threat) AND multi-tenant SaaS deployments (auth required, threat is real). Picking one model penalises the other.
* **No incident pressure.** Neither finding has produced a recorded incident in production. The audit surfaced them via static analysis; the live-system observation set is empty.
* **ADR-0247 already deferred.** ADR-0247 §F-04-006 + §F-04-007 already record "no code change (deferred per ADR Decision)" with rationale. This ADR makes the deferral durable + adds explicit re-evaluation triggers (ADR-0247's deferral was implicit).

## Considered Options

* **Option A — Defer both to next cycle, capture as ADR with triggers (this ADR)** — matches ADR-0247's existing deferral; adds re-evaluation surface.
* **Option B — Implement both now (pick a design)** — pick authoritative-source for F-04-006; pick auth model for F-04-007; ship. Speed without design data; high probability of wrong-shape rework later.
* **Option C — Split: implement F-04-007 auth (pick something), defer F-04-006** — auth model is somewhat picker-agnostic (any auth is better than none, modulo the false-confidence trap). Reconciliation strictly needs design data.
* **Option D — Add documentation-only guards (warn at startup that aidefence is unsealed; add a SECURITY.md noting F-04-006 / F-04-007 disposition)** — converts the silent-broken-seal into an explicit-broken-seal. Doesn't fix; does prevent the false-confidence mode.

## Decision Outcome

Chosen option: **"Option A — Defer both to next cycle, capture as ADR with triggers"**, because both findings are genuinely design-blocked + the security-domain hasty-fix penalty is higher than in cleanup-domain work. ADR-0247's deferral stands; this ADR makes it durable + adds the trigger surface that was missing.

**Option D is recorded as a sibling follow-up.** If the deferral window stretches beyond one cycle without a trigger firing, a documentation-only guard (startup warning + SECURITY.md disposition) becomes the right next move — it converts the silent-broken-seal into an explicit-broken-seal without forcing the design pick.

### Re-evaluation triggers

This ADR is revisited when ANY of the following holds:

1. **PII-leak incident** — `≥1` recorded operator/user report of PII leaking through aidefence (detector missed it; call-site relied on detector). One incident is enough — the design data the deferral was waiting on has now arrived.
2. **Auth-required deployment ask** — `≥1` operator request to deploy aidefence in a multi-tenant context where the `aidefence_learn` unauth surface is a documented blocker. Confirms the threat model is operationally live, not just theoretical.
3. **Cross-call-site audit produced** — someone authors an authoritative `aidefence` design doc (e.g., as part of a v4 plan or a security-review sweep) that picks: which side wins reconciliation, which auth model wires through. The design pick unblocks both findings.
4. **Adversarial-input incident** — `≥1` recorded case of `aidefence_learn` being fed poisoning training data (caught manually or via anomaly detection). The threat is no longer theoretical.
5. **Major aidefence upstream change** — upstream merges a redesign of the detector OR the learn tool that resets the call-site model. Re-evaluate the deferral against the new shape.

If NONE fire over ~6 months (longer window than ADR-0249's 3 months because security-domain design takes longer to arrive at organically), trigger **Option D** — at minimum the documentation-only guards.

### Consequences

* Good, because ADR-0247's existing deferral is now durable + auditable (re-evaluation triggers were implicit before; now explicit).
* Good, because security-design picks aren't forced by momentum — when a real incident or operator ask arrives, the design data is in hand.
* Good, because zero risk of shipping a wrong-shape auth model that creates false confidence.
* Bad, because aidefence carries known-unresolved findings indefinitely until a trigger fires — operators relying on it for PII protection in production should know the seal isn't tested at the call-site boundary.
* Bad, because `aidefence_learn` remains exploitable in multi-tenant deployments — anyone deploying in that context needs to either disable the tool, gate it externally (reverse proxy auth), or accept the risk.
* Bad, because the 6-month soft trigger to Option D (documentation-only guards) is itself a future commitment that has no automatic enforcement — relies on someone reading this ADR at cycle N+6.
* Neutral, because the deferral is documented decision rather than implicit; future sessions reading the corpus see the artifact and don't re-litigate without new evidence.

### Confirmation

Confirmation is the re-evaluation triggers themselves. Specifically:

1. ADR-0247 §F-04-006 + §F-04-007 continue to record "no code change (deferred)" — the source of truth at the ADR layer.
2. The `aidefence` module's MCP surfaces continue to function as documented (`is_pii`, `scan`, `analyze`, `learn`) — no behavioural change from this deferral.
3. When any re-evaluation trigger fires, this ADR moves to `superseded by ADR-NNNN` where ADR-NNNN is the design-pick ADR. The supersedes-by edge is the durable confirmation.
4. If 6 months pass without a primary trigger but no Option D guard has landed either, an audit-cycle review prompts the documentation-only guard work explicitly.

## Pros and Cons of the Options

### Option A — Defer both, capture as ADR with triggers (chosen)

* Good, because preserves design-pick optionality until incident/ask data arrives.
* Good, because zero false-confidence risk.
* Good, because matches ADR-0247's existing deferral; adds the missing trigger surface.
* Bad, because aidefence carries known-unresolved findings indefinitely.
* Bad, because relies on a future reader to honour the 6-month Option D commitment.

### Option B — Implement both now (pick a design)

* Good, because closes both findings; reduces the open-issue surface.
* Good, because forcing the design pick now means the team learns by doing.
* Bad, because design without data — high probability of wrong-shape rework next cycle.
* Bad, because security-domain wrong-shape rework breaks live deployments (auth model change forces caller-side update across every aidefence consumer).
* Bad, because creates false confidence — operators trust the seal that may not hold against the threat model that wasn't fully analysed.

### Option C — Split: implement F-04-007 auth, defer F-04-006

* Good, because partial closure — auth is somewhat picker-agnostic ("any auth is better than no auth" *if* the false-confidence trap is avoided).
* Good, because targets the higher-severity finding (active exploit via learn poisoning vs passive detector mismatch).
* Bad, because the false-confidence trap is real — half-baked auth labelled "secured" is worse than visibly-unauth.
* Bad, because picking one auth model now constrains the F-04-006 reconciliation design later (they share the call-site boundary).
* Bad, because the deployment-context heterogeneity (single-user CLI vs multi-tenant SaaS) hasn't been resolved — picking auth now privileges one over the other arbitrarily.

### Option D — Documentation-only guards (warn at startup, SECURITY.md)

* Good, because converts silent-broken-seal to explicit-broken-seal at zero code-fix risk.
* Good, because the operator trust signal is honest — "we know aidefence has unresolved findings F-04-006 + F-04-007; details in SECURITY.md."
* Good, because preserves design optionality (no code path locked in).
* Bad, because doesn't fix anything material — the findings remain open.
* Bad, because adds operational friction (every startup warning + every onboarding read).
* Bad, because if landed as the primary disposition, it's a slow-bleed signal that the project isn't taking the findings seriously — better landed as a sibling to a design-pick ADR than as a substitute for one.

## More Information

- [[ADR-0247]] §F-04-006 + §F-04-007 — parent deferral; this ADR is the durable + trigger-explicit version.
- [[ADR-0249]] — sibling defer ADR for typed-error sweep; same pattern (defer with explicit re-evaluation triggers).
- `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts` — current aidefence module (honesty docblock landed in Batch 3 commit `c44c0810b` already names the manual-scan-utility scope).
- Audit slice 04 — `docs/audits/2026-05-24-second-pass-audit/04-*.md` — authoritative tracker per ADR-0247.
- Session 2026-05-24 follow-up audit — the parent-session conversation that surfaced the question "do these now or defer?" and produced this ADR.
- [[ADR-0233]] §"Reviews still owed" — the second-pass parent rollup that names this work as carry-forward.
