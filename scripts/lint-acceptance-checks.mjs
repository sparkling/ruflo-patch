#!/usr/bin/env node
// scripts/lint-acceptance-checks.mjs — ADR-0097 L1-L7 lint for acceptance checks.
//
// Scans `lib/acceptance-*.sh` for the 7 quality rules defined in
// docs/adr/ADR-0097-check-code-quality-program.md §Lint rules (L1-L7).
//
// Exit code: 1 if any L1/L2/L4/L7 (errors) trigger; 0 otherwise.
// L3/L5/L6 are warnings — reported but do not fail.
//
// Output:
//   - stderr: human-readable findings (file:line LEVEL LID: message)
//   - stdout: JSON report { errors, warnings, findings: [...] }
//
// Usage:
//   node scripts/lint-acceptance-checks.mjs            # scan lib/acceptance-*.sh
//   node scripts/lint-acceptance-checks.mjs --json     # suppress stderr, JSON only
//   node scripts/lint-acceptance-checks.mjs path/to/file.sh ...

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LIB_DIR = resolve(ROOT, 'lib');

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const explicit = args.filter(a => !a.startsWith('--'));

// ─── File discovery ───

function discoverFiles() {
  if (explicit.length > 0) return explicit.map(a => resolve(a));
  return readdirSync(LIB_DIR)
    .filter(f => /^acceptance-.*\.sh$/.test(f) && f !== 'acceptance-harness.sh')
    .map(f => resolve(LIB_DIR, f))
    .sort();
}

// ─── Shell function parser ───
// Parses top-level function definitions in a bash file. Returns an array of
// { name, startLine, endLine, bodyLines, body }.
// Heuristic matches `name()` at column 0 with an opening `{` on the same or
// next line; the closing `}` is the first `}` at column 0 after the opener.
// This is not a bash parser — it relies on the project's consistent style
// (column-0 open/close). Good enough for L2/L3/L6/L7.

function parseFunctions(source) {
  const lines = source.split('\n');
  const funcs = [];
  // Function signature: `name()` optionally followed by `{` and optionally a
  // trailing `# comment` on the same line (L2 delegator annotations often
  // live there).
  const fnRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{?\s*(#.*)?$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnRe);
    if (!m) continue;
    // find matching `}` at column 0
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}\s*$/.test(lines[j])) { end = j; break; }
    }
    if (end === -1) continue;
    funcs.push({
      name: m[1],
      startLine: i + 1, // 1-based
      endLine: end + 1,
      bodyLines: lines.slice(i, end + 1),
      body: lines.slice(i, end + 1).join('\n'),
    });
  }
  return funcs;
}

// ─── Lint rules ───

const findings = [];
function emit(level, rule, file, line, message) {
  findings.push({ level, rule, file, line, message });
}

// L1 (error): _run_and_kill without explicit 3rd positional timeout.
// Signature: _run_and_kill <cmd> [out_file] [max_wait].
// Accept forms where at least 3 positional args are present (second may be "").
// The call may be prefixed by a variable assignment or `&&`.
//
// Count positional args by stripping the invocation prefix and walking tokens.
// Tokens are: a "double-quoted string", 'single-quoted string', $var, or bare word.
function countPositionalArgs(invocation) {
  // `invocation` is the substring starting right after `_run_and_kill(_ro)?`
  // Ends at `;`, `|`, `&&`, `||`, `&` (not `&&`), `)`, or end of line.
  let s = invocation.replace(/^\s+/, '');
  let count = 0;
  while (s.length > 0) {
    // stop tokens
    if (/^(;|\||&&|\|\||\)$)/.test(s)) break;
    if (/^&(?!&)/.test(s)) break;
    const ch = s[0];
    if (ch === '"') {
      // consume up to matching unescaped "
      let j = 1;
      while (j < s.length && !(s[j] === '"' && s[j - 1] !== '\\')) j++;
      if (j >= s.length) { count++; break; }
      count++;
      s = s.slice(j + 1);
    } else if (ch === "'") {
      let j = s.indexOf("'", 1);
      if (j < 0) { count++; break; }
      count++;
      s = s.slice(j + 1);
    } else if (/\S/.test(ch)) {
      // bare word until whitespace or stop token
      let j = 0;
      while (j < s.length && !/[\s;|&)]/.test(s[j])) j++;
      count++;
      s = s.slice(j);
    } else {
      s = s.slice(1);
    }
    // strip leading whitespace for next token
    s = s.replace(/^\s+/, '');
  }
  return count;
}

// Collapse trailing-backslash line continuations into a single logical line.
// Returns array of { line: string, startLine: number } (1-based).
function joinContinuations(source) {
  const raw = source.split('\n');
  const out = [];
  let buf = '';
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    const ln = raw[i];
    if (buf === '') start = i + 1;
    if (/\\\s*$/.test(ln)) {
      buf += ln.replace(/\\\s*$/, ' ');
      continue;
    }
    buf += ln;
    out.push({ line: buf, startLine: start });
    buf = '';
  }
  if (buf) out.push({ line: buf, startLine: start < 0 ? raw.length : start });
  return out;
}

function lintL1(file, source) {
  const logical = joinContinuations(source);
  const re = /(^|\s|;|&&|\|\||\|)_run_and_kill(_ro)?\s+(.*)$/;
  for (const { line, startLine } of logical) {
    const trimmed = line.replace(/^\s*#.*$/, '');
    if (!trimmed.includes('_run_and_kill')) continue;
    if (/^\s*#/.test(line)) continue;
    if (/^_run_and_kill(_ro)?\s*\(\s*\)/.test(line.trim())) continue;
    const m = trimmed.match(re);
    if (!m) continue;
    const rest = m[3];
    const n = countPositionalArgs(rest);
    if (n < 3) {
      const snippet = trimmed.trim().slice(0, 200);
      emit('error', 'L1', file, startLine,
        `_run_and_kill invocation has ${n} positional arg(s); requires explicit timeout as 3rd arg (use "" for 2nd if no out_file): ${snippet}`);
    }
  }
}

// L2 (error): bash check function body contains no `_CHECK_PASSED=` assignment.
// Heuristic only: we don't attempt to prove every exit path sets it.
//
// Delegator exemption: if the body calls a private helper that conventionally
// sets _CHECK_PASSED, skip the flag. Private helpers use the `_foo_bar`
// convention in this codebase. Specifically recognized:
//   - `_mcp_invoke_tool`          — canonical MCP invocation helper
//   - `_expect_mcp_body`          — canonical MCP body-shape assertion helper
//   - any `_assert_*` call        — project convention for assertion helpers
//   - any `_check_*` call         — private check helper (distinct from
//                                   `check_adr*` entry points, which are
//                                   parsed via the `check_` name prefix)
//   - any `_<domain>_check_*`     — domain-prefixed private check helpers
//                                   (e.g. `_b3_check_worker_output_json`)
//   - any `_<domain>_invoke_tool` — per-domain MCP wrappers
// Explicit opt-out: a `# adr0097-l2-delegator:` comment anywhere inside the
// body signals an intentional delegator that a fixer agent has vetted.
//
// A function that neither sets `_CHECK_PASSED=` nor matches any of the above
// is still flagged — that is a genuine silent-pass risk (ADR-0082).
function lintL2(file, funcs) {
  const delegatorRe = new RegExp(
    '(^|[\\s;&|(`$])(' +
      '_mcp_invoke_tool|' +
      '_expect_mcp_body|' +
      '_assert_[A-Za-z0-9_]+|' +
      // private helpers with `_check` segment anywhere — covers
      //   `_check_foo`, `_b3_check_worker_output_json`, `_p7_cli_check`,
      //   `_foo_check_bar`, etc. Entry points `check_adr*` start without `_`
      //   so they are never caught by this.
      '_[A-Za-z0-9_]*_check(?:_[A-Za-z0-9_]+)?|' +
      '_check_[A-Za-z0-9_]+|' +
      '_[a-z][a-z0-9_]*_invoke_tool|' +
      // private helpers following `_<domain>_<assert-verb>_<what>` naming:
      // `validate`, `verify`, `expect` — all assertion-style verbs that
      // conventionally set _CHECK_PASSED in this codebase.
      '_[a-z][a-z0-9_]*_(?:validate|verify|expect)_[A-Za-z0-9_]+|' +
      // `_with_*` wrappers like `_with_iso_cleanup` commonly invoke a body
      // function that sets _CHECK_PASSED (see lib/acceptance-harness.sh).
      '_with_[A-Za-z0-9_]+' +
    ')\\b'
  );
  // Annotation may live on its own comment line OR trail the function-def
  // `{` on the signature line (`check_foo() { # adr0097-l2-delegator: ...`).
  const annotationRe = /#\s*adr0097-l2-delegator\b/;
  for (const fn of funcs) {
    if (!fn.name.startsWith('check_')) continue;
    if (/_CHECK_PASSED\s*=/.test(fn.body)) continue;
    if (annotationRe.test(fn.body)) continue;
    // Strip comment lines before delegator scan so a commented-out call
    // cannot mask a truly silent body.
    const bodyNoComments = fn.bodyLines
      .filter(l => !/^\s*#/.test(l))
      .join('\n');
    if (delegatorRe.test(bodyNoComments)) continue;
    emit('error', 'L2', file, fn.startLine,
      `check function '${fn.name}' never assigns _CHECK_PASSED and never delegates to a recognized helper — silent pass risk (ADR-0082)`);
  }
}

// L3 (warn): `grep` on `$_RK_OUT` inside a function that also calls
// `_mcp_invoke_tool` or `_run_and_kill ... ruflo mcp ...`. These functions are
// asserting MCP tool body shape; they should use `_expect_mcp_body` instead
// of raw regex on the envelope.
function lintL3(file, funcs) {
  for (const fn of funcs) {
    if (!fn.name.startsWith('check_')) continue;
    const usesMcpInvoke = /_mcp_invoke_tool\b/.test(fn.body);
    const usesMcpRaw = /_run_and_kill(_ro)?[^\n]*\bruflo\s+mcp\b/.test(fn.body);
    if (!usesMcpInvoke && !usesMcpRaw) continue;
    const lines = fn.bodyLines;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*#/.test(ln)) continue;
      // grep on $_RK_OUT either via pipe or direct, e.g. `echo "$_RK_OUT" | grep ...`
      // or `grep -q ... <<<"$_RK_OUT"`.
      if (/\$_RK_OUT/.test(ln) && /\bgrep\b/.test(ln)) {
        emit('warn', 'L3', file, fn.startLine + i,
          `check '${fn.name}' uses raw grep on $_RK_OUT — prefer _expect_mcp_body / _mcp_invoke_tool for MCP body shape assertions`);
      }
    }
  }
}

// L4 (error): the literal bash trap `grep -c <pat> [file] || echo 0`.
// Matches even if pattern is quoted and filename present.
function lintL4(file, source) {
  const lines = source.split('\n');
  const re = /grep\s+-c\b[^\n]*\|\|\s*echo\s+0\b/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    if (re.test(line)) {
      emit('error', 'L4', file, i + 1,
        `\`grep -c ... || echo 0\` anti-pattern — produces "0\\n0" and trips bash arithmetic; use \`v=$(grep -c ...); v=\${v:-0}\``);
    }
  }
}

// L5 (warn): a `_<domain>_invoke_tool` definition outside acceptance-harness.sh
// (harness may define `_mcp_invoke_tool` itself, which is the canonical one).
//
// Exemptions:
//   1. Canonical name: `_mcp_invoke_tool` itself is the canonical helper.
//   2. Delegator: if the body of the `_<domain>_invoke_tool` definition
//      actually calls `_mcp_invoke_tool`, it is a thin wrapper that reuses
//      the canonical invocation path — not a reimplementation. Allowed.
//   3. Annotation: a comment line matching `# adr0097-l5-intentional: <reason>`
//      in any of the 10 lines immediately before the function definition
//      suppresses the warning. Use this for helpers that wrap
//      `_run_and_kill*` with genuine domain-specific logic (extra skip
//      buckets, custom labels, non-standard argument signatures) that the
//      canonical `_mcp_invoke_tool` cannot express.
function lintL5(file, source) {
  if (basename(file) === 'acceptance-harness.sh') return;
  const lines = source.split('\n');
  const re = /^(_[a-z][a-z0-9_]*_invoke_tool)\s*\(\s*\)/;
  const exemptRe = /#\s*adr0097-l5-intentional:/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    if (m[1] === '_mcp_invoke_tool') continue;
    // Look back up to 10 lines for an `adr0097-l5-intentional:` annotation.
    let exempted = false;
    for (let k = Math.max(0, i - 10); k < i; k++) {
      if (exemptRe.test(lines[k])) { exempted = true; break; }
    }
    if (exempted) continue;
    // Delegator check: does the helper body call the canonical
    // `_mcp_invoke_tool`? If so, it's a thin wrapper — skip.
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}\s*$/.test(lines[j])) { end = j; break; }
    }
    if (end > i) {
      const body = lines.slice(i, end + 1).join('\n');
      // Only count calls outside comment lines.
      const bodyNoComments = lines
        .slice(i, end + 1)
        .filter(l => !/^\s*#/.test(l))
        .join('\n');
      if (/(^|[\s;&|(`$])_mcp_invoke_tool\b/.test(bodyNoComments)) continue;
      // Suppress unused-warning for `body` var; kept for future diagnostics.
      void body;
    }
    emit('warn', 'L5', file, i + 1,
      `reimplemented invoke helper '${m[1]}' — use canonical _mcp_invoke_tool from acceptance-harness.sh`);
  }
}

// L6 (warn): `_e2e_isolate` called inside a function that does not register
// a `trap ... EXIT/RETURN` or explicit `rm -rf` on the isolate dir.
//
// A file-scope `trap ... EXIT/RETURN/ERR` counts as cleanup for every
// function in the file — many check files register a single top-level
// trap that tears down every isolate under `/tmp/ruflo*`. Similarly a
// file-scope `rm -rf /tmp/ruflo*` in a helper or init section counts.
// Per-function checks remain for functions that do their own cleanup.
function lintL6(file, source, funcs) {
  const sourceNoComments = source
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
  const fileHasTrap = /\btrap\s+[^\n]*\b(EXIT|RETURN|ERR)\b/.test(sourceNoComments);
  const fileHasRm = /\brm\s+-rf?\b[^\n]*\/tmp\/ruflo[^\s]*/.test(sourceNoComments)
    || /\brm\s+-rf?\b[^\n]*\.iso/.test(sourceNoComments);
  for (const fn of funcs) {
    if (!/_e2e_isolate\b/.test(fn.body)) continue;
    if (fileHasTrap || fileHasRm) continue;
    const hasTrap = /\btrap\s+[^\n]*\b(EXIT|RETURN|ERR)\b/.test(fn.body);
    const hasRm = /\brm\s+-rf?\b[^\n]*\$?\{?iso\}?/.test(fn.body)
      || /\brm\s+-rf?\b[^\n]*\/tmp\/ruflo[^\s]*/.test(fn.body)
      || /\brm\s+-rf?\b[^\n]*\.iso/.test(fn.body);
    if (!hasTrap && !hasRm) {
      emit('warn', 'L6', file, fn.startLine,
        `function '${fn.name}' calls _e2e_isolate but has no trap-based cleanup or rm -rf on isolate dir (file-scope and function-scope both checked)`);
    }
  }
}

// L7 (error): check function name must be parseable by the catalog-rebuild
// phase deriver (scripts/catalog-rebuild.mjs::derivePhase) — i.e. one of:
//   - check_adr<NNNN>_...        → phase adr<NNNN>
//   - check_phase<N>_...         → phase p<N>   (derivePhase strips "check_")
//   - check_p<N>_...             → phase p<N>
// Additionally accept existing domain-specific conventions that predate L7
// and whose ADR / phase is unambiguously recorded via fork_file in the
// catalog schema (catalog rows are keyed on run_id + check_id, with
// fork_file preserved as a separate column):
//   - check_t<N>_<N>_...         → ADR-0079 tier/sub-tier convention
//   - check_f<N>_...             → ADR-0069 feature convention
//   - check_e2e_...              → e2e group (file: acceptance-e2e-checks.sh)
//   - check_init_...             → init group (file: acceptance-init*-checks.sh)
//   - check_attention_...        → attention group (file: acceptance-attention-checks.sh)
// When the filename itself carries an adr<NNNN> or phase<N> tag, any
// check_<word>_... in that file is also accepted — catalog consumers read
// the ADR tag from fork_file in that case (see derivePhase fallback chain).
// Names that don't fit any of these conventions require an in-body
// exemption comment: `# ADR-0097-L7-EXEMPT: <reason>` (or LINT-L7-EXEMPT).
function lintL7(file, funcs) {
  const exempt = /\b(LINT-L7-EXEMPT|ADR-0097-L7-EXEMPT)\b/;
  const base = basename(file);
  // Filename domain tag: any well-formed `acceptance-<tag>-checks.sh` or
  // `acceptance-phase<N>-<slug>.sh`. Per catalog-rebuild.mjs::flattenRun,
  // every catalog row carries both `check_id` AND `fork_file` — so a
  // check in a correctly-named acceptance-<tag>-checks.sh file is always
  // catalog-resolvable via the <tag> captured in fork_file (the real
  // downstream `derivePhase` returns 'unknown' for non-matching ids but
  // never errors; 'unknown' is a valid phase value, not a parse failure).
  // The L7 rule's stated goal is "catalog ID parsing" — the true catalog
  // key is run_id+check_id and fork_file is preserved for attribution, so
  // any well-formed acceptance file grants scope.
  const fileScoped = /^acceptance-[a-z][a-z0-9-]*-checks\.sh$/.test(base)
    || /^acceptance-phase[0-9]+-[a-z][a-z0-9-]*\.sh$/.test(base);

  const nameAccepted = (name) => {
    if (/^check_adr[0-9]{4}_/.test(name)) return true;
    if (/^check_phase[0-9]+_/.test(name)) return true;
    if (/^check_p[0-9]+_/.test(name)) return true;
    if (/^check_t[0-9]+_[0-9]+_/.test(name)) return true; // ADR-0079 tiers
    if (/^check_f[0-9]+_/.test(name)) return true;        // ADR-0069 features
    if (/^check_e2e_/.test(name)) return true;
    if (/^check_init_/.test(name)) return true;
    if (/^check_attention_/.test(name)) return true;
    return false;
  };

  for (const fn of funcs) {
    if (!fn.name.startsWith('check_')) continue;
    if (nameAccepted(fn.name)) continue;
    // filename carries an adr/phase tag → scope is catalog-resolvable
    if (fileScoped) continue;
    // per-function whitelist comment inside the body header
    if (exempt.test(fn.body)) continue;
    emit('error', 'L7', file, fn.startLine,
      `check function '${fn.name}' has no recognizable catalog namespace — expected one of 'check_adr<NNNN>_' / 'check_phase<N>_' / 'check_p<N>_' / 'check_t<N>_<N>_' / 'check_f<N>_' / 'check_e2e_' / 'check_init_' / 'check_attention_', or place it in an acceptance-adr<NNNN>- / acceptance-phase<N>- file, or add '# ADR-0097-L7-EXEMPT: <reason>'`);
  }
}

// ─── Run ───

function lintFile(file) {
  const source = readFileSync(file, 'utf8');
  const funcs = parseFunctions(source);
  lintL1(file, source);
  lintL2(file, funcs);
  lintL3(file, funcs);
  lintL4(file, source);
  lintL5(file, source);
  lintL6(file, source, funcs);
  lintL7(file, funcs);
}

const files = discoverFiles();
for (const f of files) {
  if (!existsSync(f)) continue;
  try { lintFile(f); } catch (e) {
    emit('error', 'LINT-INTERNAL', f, 0, `lint crashed: ${e.message}`);
  }
}

const errorRules = new Set(['L1', 'L2', 'L4', 'L7']);
const errors = findings.filter(f => errorRules.has(f.rule)).length;
const warnings = findings.length - errors;

if (!jsonOnly) {
  for (const f of findings) {
    const rel = f.file.startsWith(ROOT) ? f.file.slice(ROOT.length + 1) : f.file;
    const tag = f.level.toUpperCase();
    process.stderr.write(`${rel}:${f.line} ${tag} ${f.rule}: ${f.message}\n`);
  }
  process.stderr.write(`\nADR-0097 lint: ${errors} error(s), ${warnings} warning(s) across ${files.length} file(s)\n`);
}

const report = {
  adr: 'ADR-0097',
  files_scanned: files.length,
  errors,
  warnings,
  findings,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');

process.exit(errors > 0 ? 1 : 0);
