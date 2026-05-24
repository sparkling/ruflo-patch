## ADR-0238 — CT-E: per-surface wire-or-remove triage for 8 unused security/telemetry/consensus surfaces

**Status**: proposed (post-swarm-review)
**Swarm**: 6 experts (5 + DA), Quorum-majority per-surface (≥4/6)
**Triage rank**: 9 (per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

All 8 surfaces ADOPTED per-surface at the per-surface quorum threshold
(≥4/6); 6 of 8 cleared with 5/6 (DA dissent) or 6/6 (unanimous). The
chosen Option A ("per-surface triage") stands intact; six lightweight
improvements were folded:

- **Surface 1 (AIDefence)**: honesty-correction + keep (5/6, DA dissent).
  Cross-reference to [[ADR-0247]] F-04-010 ride-along on the same docblock
  added.
- **Surface 2 (Claims RBAC central dispatch)**: remove API surface /
  advisory banner (6/6 unanimous).
- **Surface 3 (`agentdb_telemetry_metrics`/`_spans`)**: delete tools,
  redirect to working stat tools (5/5 telemetry-specialist + general
  vote, DA agreed). Confirmation gate extended: `observe-metrics` skill
  must resolve the 4 redirected tools at HEAD.
- **Surface 4 (Dead `swarm/src/consensus/*.ts`)**: quarantine, do not
  delete (5/6, DA dissent). Rationale **strengthened** with specific
  upstream-investment evidence — 3 commits on `transport.ts` +
  `federation-transport.ts` titled "ADR-095 G2 pluggable
  ConsensusTransport + Ed25519 message signing", most recent
  `22ca3b018` on **2026-05-11** (13 days before this review). File-header
  comment must cite the commit so future upstream-sync agents see the
  live evidence.
- **Surface 5 ("Raft" naming honesty)**: description honesty (6/6).
- **Surface 6 (`paxos` silent substitution)**: bundled with Surface 4;
  remove enum + switch case (6/6). Implementation-sequencing note:
  Surface 6 changes go in the **same commit** as Surface 4's quarantine
  arch-test.
- **Surface 7 (`weighted` enum CLI alignment)**: add to CLI enum (6/6).
  Zero-merge-tax (upstream has same drift); fastest win in this ADR.
- **Surface 8 (5 consensus agent .md frontmatter honesty)**: `advisory: true`
  frontmatter + leading "Advisory roleplay only" paragraph (5/6, DA dissent).
  Implementation note: if `advisory` is a novel frontmatter field,
  document the schema in a one-line addendum to `cli/.claude/agents/README.md`.

DA holds principled dissent on Surfaces 4 + 1 + 8 framings (quarantine
maintenance debt; central-wiring deferral leaves F-04-001 unmitigated;
consensus prompt-body language still leads operators). All flagged as
future re-evaluation opportunities; none block the per-surface adoption.

### Implementation steps

1. **Surface 2 (advisory banner — easy + unanimous first)**: add a leading
   banner to `claude-flow claims check/grant/list` CLI commands:
   `"ADVISORY: this command writes policy that NOTHING currently enforces. See ADR-0238 Surface 2."`
   OR delete the command surface entirely (record the chosen sub-option in
   the implementation commit). Update `cli/src/commands/claims.ts` per
   ADR-0238 Surface 2 §Action.
2. **Surface 7 (enum alignment — zero-merge-tax)**: add `'weighted'` to
   `cli/src/mcp-tools/hive-mind-tools.ts:73` `ConsensusStrategyName` enum
   and the `hive-mind --consensus` flag enum in `commands/hive-mind.ts`.
   Update help text + skill doc count from 5 to 6 modes. The 277-LOC
   `weighted.ts` handler already works.
3. **Surface 5 (description honesty)**: rewrite `commands/hive-mind.ts:146`
   help text from "Raft, Leader-based consensus" to "Raft-flavoured:
   term-bucketed majority voting against a queen-elected leader (no leader
   election, no log replication, no RPC)". Same rewrite to MCP tool schema
   description.
4. **Surface 1 (framing-honesty docblock pass)**: rewrite
   `@claude-flow/aidefence/src/index.ts:1-30` to "manual scan utility"
   framing per F-04-005 **AND** add the F-04-010 ride-along
   (per [[ADR-0247]] Site 2) clarifying HNSW scope: "HNSW search of past
   learned patterns (`searchSimilarThreats`); detection latency is a fixed
   regex pass over 50 patterns, not HNSW-accelerated." Rewrite
   `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md` 3-gate
   ADR + plugin README. Remove `aidefence_verdict` mention from
   `browser-session-tools.ts:306,308,323-329`.
5. **Surface 3 (delete telemetry tools + redirect)**: delete the two MCP
   tool registrations at `cli/src/mcp-tools/agentdb-tools.ts:1587-1641`.
   Update `agents/observability-engineer.md` + `observe-metrics`/`observe-trace`
   skills to point at `agentdb_resource_usage`, `agentdb_circuit_status`,
   `agentdb_rate_limit_status`, `agentdb_query_stats` (verify all 4
   resolve at HEAD via `getController`). Mark ADR-0045 supersession in the
   deletion commit.
6. **Surface 4 + 6 (quarantine + paxos enum removal — same commit)**:
   add file-header to `swarm/src/consensus/{raft,byzantine,gossip,index}.ts`:
   `// QUARANTINED: not reachable from any user-facing path; reach via dispatch through agentdb/archivist/handlers/hive-mind/consensus/* instead. Retained to track upstream's investment.`
   `// Upstream is actively extending this surface (see ruvnet/ruflo commit 22ca3b018, ADR-095 G2 — pluggable ConsensusTransport, 2026-05-11). Delete-or-quarantine decision dispatched per ADR-0238 quarantine disposition.`
   Add arch-test at `swarm/__tests__/no-new-consensus-imports.test.ts`
   forbidding new `.ts` files from importing from `./consensus/` (existing
   `unified-coordinator.ts:303` allowlisted). Update `swarm/README.md` to
   mark the `ConsensusEngine` example as "experimental; live consensus
   path is `hive-mind --consensus <mode>`". In the same commit: remove
   `'paxos'` from `swarm/src/types.ts:199` `ConsensusAlgorithm` and
   `swarm/src/index.ts:326` `CONSENSUS_ALGORITHMS`; delete the
   `case 'paxos':` fall-through at `consensus/index.ts:77-85`.
7. **Surface 8 (5 consensus agent frontmatter honesty)**: add to each of
   `cli/.claude/agents/consensus/{byzantine-coordinator,raft-manager,gossip-coordinator,crdt-synchronizer,quorum-manager}.md`
   frontmatter: `advisory: true`. Add leading body paragraph:
   `**Advisory roleplay only.** This agent's prompt describes distributed-consensus mechanisms (PBFT, Raft, gossip, CRDT, quorum) but spawning it does NOT enforce them. Real consensus dispatch goes through `hive-mind --consensus <mode>` → `agentdb/archivist/handlers/hive-mind/consensus/*` (single-process state-merge with per-strategy threshold arithmetic). The byzantine-coordinator name does not connect to PBFT three-phase protocol implementation.`
   Same edit to `consensus-builder.md` + `security-manager.md`. If
   `advisory` is novel, document in `cli/.claude/agents/README.md` (one
   line: "`advisory: true` — agent prompt is cognitive-scaffold only; no
   real dispatch path connects the name to enforcement").
8. **INTEGRATION-LEDGER rows**: per [[feedback-update-integration-ledger]],
   each fork-only fix gets a row.
   - Surface 1: `aidefence/src/index.ts` rewrite (joint with [[ADR-0247]] F-04-010); `browser-session-tools.ts:306-329`; `0001-aidefence-contract.md` rewrite.
   - Surface 2: `commands/claims.ts` advisory banner OR deletion.
   - Surface 3: `agentdb-tools.ts:1587-1641` deletion (fork-only invention; ledger disposition `delete-fork-only`).
   - Surface 4: 4 file-header additions + arch-test + README update — `superseded-by-local` against upstream's continuing investment (cite `22ca3b018`).
   - Surface 5: `hive-mind.ts:146` + MCP schema description; small text-only fork divergence.
   - Surface 6: `swarm/src/{types.ts,index.ts,consensus/index.ts}` — enum + case removal.
   - Surface 7: `hive-mind-tools.ts:73` + `commands/hive-mind.ts` enum add (zero merge tax — upstream same drift).
   - Surface 8: 5+2 agent .md frontmatter edits (matches upstream same files; small divergence per file).
9. **Behavioural acceptance** per surface:
   - Surface 1: `grep -rn "AI Manipulation Defense\|self-learning capabilities\|HNSW-indexed threat pattern search" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts forks/ruflo/plugins/ruflo-aidefence/README` returns zero hits.
   - Surface 2: `claude-flow claims check` either prints the ADVISORY banner OR command is absent.
   - Surface 3: `grep -rn "agentdb_telemetry_metrics\|agentdb_telemetry_spans" forks/ruflo/v3/@claude-flow/cli/src/` returns ZERO; `observe-metrics` skill test resolves the 4 redirected tools.
   - Surface 4: arch-test passes (no NEW `.ts` files import from `./consensus/`); file headers present on all 4 files; README "experimental" disclaimer present.
   - Surface 5: `commands/hive-mind.ts:146` no longer says "Raft, Leader-based consensus" without "Raft-flavoured" qualifier; MCP schema description matches.
   - Surface 6: `grep -rn "'paxos'" forks/ruflo/v3/@claude-flow/swarm/src/` returns zero hits.
   - Surface 7: `claude-flow hive-mind --consensus weighted` accepts at parse and dispatches to the agentdb `weighted` handler; behaviour test exercises end-to-end propose+vote+resolve.
   - Surface 8: all 5 consensus agent .md files + `consensus-builder.md` + `security-manager.md` have `advisory: true` frontmatter + leading "Advisory roleplay only" paragraph.

### Dependencies

- [[ADR-0210]] — stub-honesty mandate (governing principle); Surfaces 1, 5,
  8 implement its Option B′ item 6 (description honesty); Surfaces 2, 3
  implement its delete arm.
- [[ADR-0201]] — pre-flight checklist; all 8 surfaces cleared all 4 checks.
- [[ADR-0247]] (CT-N sibling) — F-04-010 ride-along on Surface 1 docblock;
  F-04-006/F-04-007 deferred there with rationale matching Surface 1 here.
- [[ADR-0239]] (CT-F) — cluster 2 deletes `v3/mcp/` (consistent pattern);
  this ADR's Surface 4 explicitly **inverts** to quarantine because
  upstream invests in the swarm consensus tree but not in `v3/mcp/`.
- [[ADR-0095]] — no-fallbacks; Surface 6 (silent paxos→raft) is an
  instance; Surface 2 (half-implemented auth) is an anti-pattern.
- [[ADR-0203]] / [[ADR-0222]] — delete-dead-package precedents (Surface
  3 follows; Surface 4 inverts).
- [[ADR-0217]] — quarantine + arch-test pattern (precedent for Surface 4
  approach).
- [[ADR-0233]] §CT-E — defect-class origin.

### Validation

- All 8 source-shape greps in Decision §Confirmation (per surface).
- Per-surface behaviour tests as detailed in Implementation step 9.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: Surface 4's quarantine accretes maintenance debt (file-header
  triage + per-merge `--ours` on the consensus subtree) for code that may
  never run in production. If upstream's ADR-095 G2 transport investment
  stalls and no real consumer wires `ConsensusEngine` within 6-12 months,
  the quarantine becomes permanent dead code with bookkeeping cost the
  ADR doesn't recoup.
- **Mitigation**: file-header cites the specific upstream commit
  (`22ca3b018` ADR-095 G2 step 1, 2026-05-11) so future upstream-sync
  agents have a concrete reference to re-evaluate. Add a memory entry
  (`project-adr0238-surface4-quarantine-watch`) noting the
  upstream-investment-watch posture: re-evaluate Surface 4 if (a) upstream
  abandons ADR-095 G2 work for >6 months OR (b) a real consumer wires
  `ConsensusEngine` (in which case the quarantine should lift and
  Surface 4 graduates to wire-then-keep). DA's principled dissent
  recorded for re-evaluation trigger.

### Key upstream finding

**The CT-E quarantine decision for Surface 4 is confirmed and
strengthened.** Upstream is actively investing in the consensus tree
via ADR-095 G2 (steps 1+4): pluggable `ConsensusTransport` interface
with `LocalTransport` + `FederationTransport` implementations, Ed25519
message signing, fail-closed signature verification. Most recent commit
`22ca3b018` landed **2026-05-11**, 13 days before this review. The
commit messages explicitly target F-09-002 (the "single-process Map
peers" gap). Quarantine over delete is correct; the ADR's "investment"
claim was understated and is now backed by concrete commit citations
in both the file headers and INTEGRATION-LEDGER rows.
