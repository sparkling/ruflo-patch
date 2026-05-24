## ADR-0240 — CT-G: stderr-only logging for StdioServerTransport

**Status**: proposed (post-swarm-review)
**Swarm**: 3 experts + devil's advocate, Quorum-majority consensus
**Triage rank**: 1 (highest priority per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

Apply **Option A + narrow Option B lint rider** as originally drafted, with two scope
clarifications surfaced by the panel: (i) the Source-shape Confirmation gate is narrowed
to `agentdb-mcp-server.ts` specifically — the surrounding agentdb cli paths contain 60+
legitimate `console.log` calls that are out of CT-G scope per F-05-007; (ii) the lint
rider creates a new ESLint config under `forks/agentdb/.eslintrc*` (and conditional
`forks/ruflo/v3/mcp/.eslintrc*` per CT-F outcome) since neither file exists today. Site
#2 (agentdb) ships unconditionally; site #1 (v3/mcp/) is contingent on [[ADR-0239]]
(CT-F cluster 2) deciding to keep v3/mcp/. DA holds principled dissent on stderr-pipe
pressure under high tool-call volume (out of CT-G scope; future observability work).

### Implementation steps

1. **Site #2 unconditional fork-side fix** in `forks/agentdb/src/mcp/agentdb-mcp-server.ts:2016`:
   change `console.log` → `console.error`. One-line edit matching the file's 21 sibling
   `console.error` calls. Commit per `[[feedback-commit-forks-before-release]]`.
2. **ESLint config creation** at `forks/agentdb/.eslintrc.json` (new file): declare
   `no-console: ['error', { allow: ['error', 'warn'] }]` scoped via `overrides.files` to
   `src/mcp/**/*.ts` only — avoids touching the daemon-side 60+ legitimate `console.log`
   sites that F-05-007 will own separately.
3. **INTEGRATION-LEDGER row** for site #2: `superseded-by-local` disposition citing this
   ADR; upstream `ruvnet/agentdb/src/mcp/agentdb-mcp-server.ts:2000` carries the
   byte-identical defect, so this is fork-only merge-tax until upstream takes a matching
   patch. Record per `[[feedback-update-integration-ledger]]`.
4. **Conditional site #1 hold** in a draft branch: if [[ADR-0239]] (CT-F cluster 2)
   decides to **keep** `v3/mcp/`, apply `console.info` → `console.error` (`:148`) and
   `console.debug` → `console.error` (`:143`) at `forks/ruflo/v3/mcp/server-entry.ts`
   plus the parallel `.eslintrc.json` creation. If CT-F **deletes** v3/mcp/, retract the
   site #1 fix (the entire subtree evaporates and the cross-bonus closes F-05-001
   automatically per [[ADR-0239]] cluster 2 row).
5. **Acceptance check** invoked via `_run_and_kill` (registered in both `run_check_bg`
   and `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`): boot
   `agentdb mcp start`, issue an MCP `learning_train` request, parse every stdout line —
   all lines must be valid JSON-RPC frames; ZERO `🎓 Training session ...` bytes on
   stdout. Boot is unblocked by [[ADR-0213]]'s `busy_timeout` fix (fork commit `d1b6145`).

### Dependencies

- [[ADR-0226]] — sibling fix for frame-write side of the same stdio JSON-RPC channel;
  establishes the `writeFrame` pattern this ADR's diagnostic-side rule complements.
- [[ADR-0213]] — unblocks the agentdb MCP server boot (`busy_timeout` allowlist fix);
  without this, site #2 was unreachable at runtime. Now satisfied per the 2026-05-24
  amendment.
- [[ADR-0239]] (CT-F cluster 2) — gates site #1. Cross-bonus: if v3/mcp/ is deleted,
  F-05-001 + F-10-002 close together with one delete.
- [[ADR-0233]] §CT-G — defect-class origin citing F-05-001 (HIGH) and F-05-002 (HIGH).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (all four
  checks pass: signal-reaches-audience for both sites; upstream-not-decided; premise
  true at runtime; no sibling-ADR overlap).

### Validation

- Source-shape grep: `forks/agentdb/src/mcp/agentdb-mcp-server.ts` has zero `console.log`
  calls (scoped to this single file; sibling cli paths excluded).
- Source-shape grep (conditional): `forks/ruflo/v3/mcp/server-entry.ts:140-162` —
  `createLogger.info` and `.debug` keys both invoke `console.error`.
- ESLint pass: `npm run lint --workspace=forks/agentdb` (or equivalent) fails red on a
  deliberate `console.log` re-introduction in `src/mcp/**`.
- Behavioural acceptance: `agentdb mcp start` followed by `learning_train` — stdout is
  parseable as JSON-RPC frames only; no `🎓 Training session` bytes on stdout (they may
  appear on stderr, which is correct).
- Behavioural acceptance (conditional on CT-F keep): `npx tsx v3/mcp/server-entry.ts`
  with default `--log-level info` — stdout contains only the `notifications/server/ready`
  frame; no `[ISO-timestamp] [INFO] Starting Claude-Flow MCP Server V3 ...` lines.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: site #2 lands but the lint rider's new ESLint config doesn't run on CI (no
  pipeline step invokes `npm run lint` in `forks/agentdb/`), so the next slip slips
  again — recreating the F-05-002 shape. Same pre-flight #1 trap that flipped ADR-0207
  ("signal reaches audience").
- **Mitigation**: register the lint as an acceptance-tier check (per step 5's
  `_run_and_kill` registration), not just an ESLint warning. The check explicitly
  greps `console.log` in `forks/agentdb/src/mcp/**` and fails the release if non-zero.
  Belt + braces: lint warns developers at edit time; acceptance check fails the release
  if the lint is ignored. Matches the [[ADR-0215]] golden-master pattern.
