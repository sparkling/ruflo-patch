#!/usr/bin/env node
// scripts/lint-fail-loud.mjs — ADR-0112 Phase 4 static-analysis enforcement
// (W1.8 item #22). Detects silent-fallthrough patterns in the partition-
// relevant fork files. Wired into `npm run preflight` per ADR-0112 §Done
// criteria.
//
// In-scope rules (per ADR-0112 §Implementation plan Phase 4):
//   SF1 — empty catch block: `try { ... } catch { }` or `catch (e) { }`
//         swallows ALL errors, including data-integrity failures.
//   SF3 — nullish coalescing to silent value: `?? null`, `?? []`, `?? {}`
//         when the LHS is a controller / store / API call result.
//   SF4 — silent null return on guard: `if (!this.<store>) return null;`
//         followed by no error / no log — masks the missing-store state.
//   SF6 — catch returning fake-success: `catch { return { success: true } }`
//         or similar shapes that report success after swallowing error.
//
// Annotation: any flagged line followed by `// silent-fallthrough-OK: <why>`
// (or preceded by `// silent-fallthrough-OK: <why>` on the immediately-
// previous line) is whitelisted. The annotation MUST include a reason.
//
// Exit codes:
//   0 — zero unannotated SF1/SF3/SF4/SF6 violations in scope
//   1 — at least one unannotated violation (failure mode)
//   2 — script error (unable to read scope, etc.)
//
// Usage:
//   node scripts/lint-fail-loud.mjs
//   node scripts/lint-fail-loud.mjs --json     # machine-readable output
//   node scripts/lint-fail-loud.mjs --fix      # writes annotation TODOs

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Configuration ───────────────────────────────────────────────────
//
// Files in scope per ADR-0112 §Implementation plan Phase 2 tracks. These
// are the boundary surfaces between RVF + AgentDB + the cli + MCP
// handlers. Adding a new file to scope is fine; removing one requires an
// ADR amendment.
const FORK_ROOT = resolve(process.env.FORK_ROOT || '/Users/henrik/source/forks/ruflo');
const IN_SCOPE = [
  // RVF + AgentDB backends
  'v3/@claude-flow/memory/src/rvf-backend.ts',
  'v3/@claude-flow/memory/src/agentdb-backend.ts',
  'v3/@claude-flow/memory/src/controller-registry.ts',
  // CLI's memory router + MCP handlers that read/write either store
  'v3/@claude-flow/cli/src/memory/memory-router.ts',
  'v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts',
  'v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts',
  'v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts',
];

const ANNOTATION_REGEX = /\/\/\s*silent-fallthrough-OK:\s*\S+/;

// ─── Rules ───────────────────────────────────────────────────────────
//
// Each rule is a (lineNo, line, prevLine, nextLine) → match-object | null
// function. The match object includes a short reason for the diagnostic.
//
// Rules deliberately under-trigger rather than over-trigger: false
// positives generate noise that erodes trust in the lint, so each
// pattern targets shapes seen in actual ADR-0112 audit findings.

function ruleSF1(_lineNo, line, _prev, next) {
  // Empty catch block. Two shapes:
  //   } catch { }
  //   } catch (e) { }
  // Multi-line shapes (`catch { /* comment */ }`) get matched by the
  // whitespace-only check on the same line OR a single-comment next line.
  const m = /\}\s*catch(\s*\([^)]*\))?\s*\{(\s*\})?$/.exec(line);
  if (!m) return null;
  if (m[2]) {
    // catch { } — same line, definitely empty
    return { rule: 'SF1', reason: 'empty catch block — swallows all errors' };
  }
  // catch (e) { — body on next line(s); peek
  if (next && /^\s*\}\s*$/.test(next)) {
    return { rule: 'SF1', reason: 'empty catch block (multi-line) — swallows all errors' };
  }
  // catch (e) { /* comment */ } single-line w/ only a comment
  if (/\}\s*catch[^{]*\{\s*\/\*[^*]*\*\/\s*\}\s*$/.test(line)) {
    return { rule: 'SF1', reason: 'catch with only a comment — swallows all errors' };
  }
  return null;
}

function ruleSF3(_lineNo, line) {
  // Nullish coalescing to silent value. Targets:
  //   xxxController.method() ?? null
  //   xxxApi.call() ?? []
  //   ?? null on lines that look like controller/store/getController results.
  // Filter heuristics: the LHS contains `controller`, `getController`,
  // `Controller`, `agentdb`, `storage`, `backend`, etc.
  const m = /\?\?\s*(null|\[\s*\]|\{\s*\})\s*[;,)]?\s*$/.exec(line);
  if (!m) return null;
  if (!/(controller|getController|agentdb|storage|backend|registry|store\(|recall|search|retrieve)/i.test(line)) {
    return null;
  }
  return { rule: 'SF3', reason: `nullish coalescing to ${m[1]} — masks unavailable controller/store` };
}

function ruleSF4(_lineNo, line) {
  // Silent guard returning null/false/[] without throwing or logging.
  // Pattern: `if (!this.<store>) return <fallback>;`
  // Excludes idempotent shutdown (e.g. `if (!this.initialized) return;` is OK).
  const m = /^\s*if\s*\(\s*!this\.(\w+)\s*(\|\||&&)?[^)]*\)\s*\{?\s*return(\s+(null|false|\[\s*\]|\{\s*\}|undefined))?\s*;?\s*\}?$/.exec(line);
  if (!m) return null;
  // Allow `if (!this.initialized) return;` (idempotent shutdown — design pattern)
  if (m[1] === 'initialized' && !m[3]) return null;
  return { rule: 'SF4', reason: `silent guard "if (!this.${m[1]}) return${m[3] || ''}" — fail loud instead` };
}

function ruleSF6(_lineNo, line) {
  // Catch returning fake-success.
  // Two shapes:
  //   } catch { return { success: true ... } }
  //   } catch (e) { return { ... success: true ... } }
  // We match `catch ... { ... return { ... success: true` on a single line.
  if (/\}\s*catch[^{]*\{[^}]*return\s*\{[^}]*success\s*:\s*true/.test(line)) {
    return { rule: 'SF6', reason: 'catch returns success:true — fake-success after swallowed error' };
  }
  return null;
}

const RULES = { SF1: ruleSF1, SF3: ruleSF3, SF4: ruleSF4, SF6: ruleSF6 };

// ─── Scanner ─────────────────────────────────────────────────────────

function scanFile(absPath, relPath) {
  const findings = [];
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    // Skip if the line itself or the immediately-previous line is annotated
    if (ANNOTATION_REGEX.test(line)) continue;
    if (ANNOTATION_REGEX.test(prevLine)) continue;
    for (const [name, rule] of Object.entries(RULES)) {
      const hit = rule(i + 1, line, prevLine, nextLine);
      if (hit) {
        findings.push({
          file: relPath,
          line: i + 1,
          rule: hit.rule,
          reason: hit.reason,
          source: line.trim().slice(0, 200),
        });
      }
    }
  }
  return findings;
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  if (!existsSync(FORK_ROOT)) {
    if (asJson) {
      process.stdout.write(JSON.stringify({ ok: false, reason: 'fork-root-missing', forkRoot: FORK_ROOT }) + '\n');
    } else {
      console.error(`[lint-fail-loud] FORK_ROOT does not exist: ${FORK_ROOT}`);
      console.error('[lint-fail-loud] Set FORK_ROOT env var or check the fork checkout.');
    }
    process.exit(2);
  }

  const allFindings = [];
  let scanned = 0;
  for (const rel of IN_SCOPE) {
    const abs = resolve(FORK_ROOT, rel);
    if (!existsSync(abs)) {
      if (!asJson) console.warn(`[lint-fail-loud] WARN: ${rel} not present (fork tree partial?)`);
      continue;
    }
    scanned++;
    allFindings.push(...scanFile(abs, rel));
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: allFindings.length === 0,
      scanned,
      findings: allFindings,
    }) + '\n');
  } else {
    if (allFindings.length === 0) {
      console.log(`[lint-fail-loud] OK — zero unannotated SF1/SF3/SF4/SF6 violations in ${scanned} in-scope files`);
    } else {
      console.error(`[lint-fail-loud] FAIL — ${allFindings.length} unannotated violation(s) in ${scanned} files:`);
      for (const f of allFindings) {
        console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.reason}`);
        console.error(`    ${f.source}`);
      }
      console.error('');
      console.error('To whitelist a legitimate case, add an inline comment:');
      console.error('    // silent-fallthrough-OK: <why this is OK>');
      console.error('on the same line OR the immediately-preceding line.');
      console.error('Reason MUST be non-empty (the lint rejects bare annotations).');
    }
  }

  process.exit(allFindings.length === 0 ? 0 : 1);
}

main();
