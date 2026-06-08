---
status: proposed
date: 2026-06-08
tags: [codex, init, dual-mode, mcp-registration, fork-regression, fork-maintenance]
supersedes: []
depends-on: [ADR-0301]
implements: []
---

# Repair the fork's `init --codex` execution path (test-install-driven)

## Context and Problem Statement

The fork ships a `--codex` (and `--dual`) init path that scaffolds OpenAI Codex
surfaces (`AGENTS.md`, `.agents/`, `.codex/`) and registers the ruflo MCP
server with the Codex CLI. A 2026-06-08 real run — `npx -y
@sparkleideas/ruflo@latest init --with-embeddings --full --force --start-all
--codex` in `~/source/hm/semantic-learn` — exited 0 but surfaced multiple
defects, proving the `--codex` path was never realm-corrected for the fork and
carries unverified assumptions about the user's environment.

Project-maintainer context: the project owner is Claude-only and does not
personally use Codex (see memory `feedback-no-codex-mentions`). This ADR is
therefore **fork-product maintenance** — the fork advertises `--codex` to *its*
users, so the path must be honest and work — and is deliberately decoupled from
the owner's own usage (the owner will not run `--codex`; the acceptance gate
must exercise it in a sandbox, not on a real project).

### Bugs already surfaced (the test-install must confirm + complete this list, not trust it)

1. **MCP registration registered the WRONG server.** `@claude-flow/codex`'s
   `initializer.ts` hard-coded `codex mcp add claude-flow -- npx claude-flow
   mcp start` — the **upstream** `claude-flow` binary under the name
   `claude-flow`, not the fork's `ruflo` / `@sparkleideas/ruflo` (the
   Claude-Code side correctly uses `claude mcp add ruflo -- npx -y
   @sparkleideas/ruflo@latest mcp start`). A point-fix landed in `forks/ruflo`
   `3ccb64e0e` (registers `ruflo` + fork binary, with an `npx -y
   @openai/codex@latest` fallback). **This ADR must VERIFY that fix under a
   clean test-install — a working manual repro is not proof the shipped path is
   correct (cf. `feedback-trace-bin-entry-before-patching`).**
2. **`codex mcp add` assumed a current global Codex.** It failed on a stale
   brew `codex` 0.27.0, whose `mcp` is server-only (`unexpected argument
   'add'`). The point-fix adds an `npx @openai/codex@latest` fallback; the
   ADR must confirm the fallback path actually fires and is not itself fragile.
3. **"Bundled skills directory not found" warning.** The init warned
   `Bundled skills directory not found: <npx-cache>/.agents/skills` yet still
   reported 109 skills installed — they were copied from
   `node_modules/agentic-flow/.claude/skills`, not the warned `.agents/skills`
   path. A path/provenance mismatch: either the warned probe path is wrong, or
   the copy source is incidental. Investigate and make the source path correct
   + the warning honest (or remove it).
4. **`--codex` writes codex-ONLY scaffolding.** No `.claude/settings.json`,
   `.claude/helpers/`, `.mcp.json`, or `CLAUDE.md` are written under `--codex`
   (only `--dual` produces both). Determine whether codex-only is the intended
   contract; if so, document it loudly at the call site and in `init --help`
   so a user doesn't silently end up with no Claude-Code integration.
5. **Generated content may cite upstream `claude-flow`.** `AGENTS.md` and other
   generated codex content (e.g. `npx @claude-flow/cli mcp start` examples)
   may carry upstream identifiers the codemod did not rewrite. Audit the
   generated codex artifacts for realm-correctness.

## Decision Drivers

* An advertised init surface that registers the *wrong* (upstream) MCP server
  is the dishonest-capability class the fork's own rules forbid (ADR-0210,
  ADR-0301 realm-identity).
* The reported bugs were found by *running* it, not reading it — the fix must
  be **test-install-driven**: enumerate by execution, not by inspection, so no
  defect is missed and the point-fix (1) is actually validated end-to-end.
* The owner will not run `--codex`, so coverage must be a sandboxed acceptance
  gate, wired into the standard runner (`feedback-always-wire-tests-into-cicd`).
* Realm-correctness: every fork-emitted identifier must be `ruflo` /
  `@sparkleideas/*`, never upstream `claude-flow` (ADR-0301).

## Considered Options

* **Test-install-driven repair (chosen).** First run `init --codex` in a clean
  throwaway dir and trace the actual execution path to enumerate *all* bugs;
  then fix each with realm-correct fork identity; then wire a sandbox
  acceptance check; then both-ways verify.
* **Fix-from-the-known-list only.** Patch the 5 bugs above and stop — rejected:
  the list came from one run's *visible* warnings; the execution-path trace is
  what guarantees completeness (the init exited 0 while broken, so silent
  defects are likely).
* **Remove `--codex` from the fork entirely.** Rejected: the fork ships it as a
  product feature for its codex users; the owner's non-use is not the fork's
  users' non-use. Removal is a separate product decision, not a bug fix.
* **Record-only (no fix).** Rejected: bug (1) ships a wrong-server registration
  to every fork `--codex` user today.

## Decision Outcome

Chosen option: "Test-install-driven repair." This ADR records the plan and
authorises **no code** beyond the already-landed point-fix `3ccb64e0e` (which
it must validate). Implementation is gated on an explicit go-ahead.

### Tasks

* **T1 — Trace the `--codex` execution path (audit, first).** Map the full
  `--codex` flow end to end: `cli/src/commands/init.ts` → `init/executor.ts`
  (the `--codex`/`--dual` branch) → `@claude-flow/codex` `src/initializer.ts`
  (`registerMcpServer`, `generateAgentsMd`, skills copy) and any
  dual-mode orchestrator. Produce a written path map: which files are written,
  which external commands are run (`codex mcp add`, skills copy), and every
  branch `--codex` vs `--dual` differ on. This is the bug-enumeration spine —
  do it BEFORE any further fix.
* **T2 — Test install + enumerate.** `init --codex` in a clean `/tmp` dir
  (node-24, fork `@sparkleideas/ruflo@latest`); capture full output; confirm
  bugs (1)–(5) and add any the trace/run reveals. Verify the `3ccb64e0e`
  point-fix actually registers `ruflo`/`@sparkleideas/ruflo` (read back `codex
  mcp list`) and that the `npx @openai/codex@latest` fallback fires when the
  on-PATH codex is absent/stale.
* **T3 — Fix each enumerated bug** with realm-correct identity (no upstream
  `claude-flow` in any fork-emitted string; skills source path correct;
  codex-only-vs-dual contract documented).
* **T4 — Acceptance gate.** Wire a SANDBOXED check into `test-acceptance*.sh`
  (`run_check_bg` + `collect_parallel`) + CI that runs `init --codex` in a
  throwaway dir and asserts: codex MCP registration names `ruflo` and launches
  `@sparkleideas/ruflo`; zero upstream `claude-flow` identifiers in generated
  artifacts; no spurious "bundled skills not found" warning; the documented
  scaffolding set is present. Must not require a globally-installed codex
  (use `npx @openai/codex@latest` or stub) and must not write outside the
  sandbox.
* **T5 — Both-ways verify** against published vs fixed, per the standard.

### Consequences

* Good, because the fork stops shipping a wrong-server codex registration and
  the `--codex` path gains its first real acceptance coverage.
* Good, because the test-install-first method validates the already-landed
  point-fix instead of assuming it (the init exited 0 while broken — a strong
  reason not to trust inspection alone).
* Bad, because it invests maintenance effort in a feature the owner does not
  personally use — justified only by the fork's product surface honesty.
* Neutral, because the owner's Claude-only usage ban (`feedback-no-codex-mentions`)
  is unaffected: this fixes the fork's code, it does not make the owner use codex.

### Confirmation

The T4 sandbox acceptance check, green in a release, is the compliance signal:
init `--codex` registers the fork `ruflo` server (not upstream `claude-flow`),
generated artifacts are realm-clean, and the skills/warning paths are honest.
Until that check exists and is green, this ADR stays `proposed`.

## More Information

* Point-fix already landed (to be validated, not assumed): `forks/ruflo`
  `3ccb64e0e` — codex `initializer.ts` registers `ruflo` + `@sparkleideas/ruflo`
  with an `npx @openai/codex@latest` fallback.
* Realm-identity precedent: [[ADR-0301]] (fork marketplace identity —
  `sparkleideas`/`ruflo`, never upstream `ruflo`/`claude-flow` collision). The
  codex MCP-registration bug is the same realm-correctness class on the codex
  surface.
* Method precedents: `feedback-trace-bin-entry-before-patching` (a working
  manual repro does not prove the shipped path is reached/correct),
  `feedback-always-wire-tests-into-cicd` (sandbox gate, not a manual smoke).
* Owner-usage context: `feedback-no-codex-mentions` (Claude-only; this ADR is
  fork-product maintenance, explicitly carved out from the usage ban).
* Incident source: 2026-06-08 `init --codex` run on `~/source/hm/semantic-learn`.
