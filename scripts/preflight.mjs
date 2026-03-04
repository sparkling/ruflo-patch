#!/usr/bin/env node
// scripts/preflight.mjs — Pre-commit/pre-publish consistency check.
// Syncs: doc tables, defect counts across all files.
// Source of truth: package.json (version), patch/*/ (defects).
//
// Usage: node scripts/preflight.mjs [--check]
//   --check  Exit 1 if anything is out of date (for hooks/CI), don't write.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../lib/discover.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

const data = discover();
const { patches, categories, stats } = data;

// ── Helpers ──

function replaceMarkerSection(filePath, markerName, newContent) {
  const beginMarker = `<!-- GENERATED:${markerName}:begin -->`;
  const endMarker = `<!-- GENERATED:${markerName}:end -->`;

  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return false; // File doesn't exist yet
  }

  const beginIdx = text.indexOf(beginMarker);
  const endIdx = text.indexOf(endMarker);

  if (beginIdx < 0 || endIdx < 0) return false;

  const before = text.slice(0, beginIdx + beginMarker.length);
  const after = text.slice(endIdx);
  const updated = `${before}\n${newContent}\n${after}`;

  if (updated === text) return false;

  if (!checkOnly) writeFileSync(filePath, updated);
  return true;
}

// ── Generate CLAUDE.md defect tables ──

function generateClaudeTables() {
  const groups = new Map();
  for (const p of patches) {
    if (!groups.has(p.prefix)) groups.set(p.prefix, []);
    groups.get(p.prefix).push(p);
  }

  const lines = [];

  lines.push('| Prefix | Category | Count |');
  lines.push('|--------|----------|-------|');
  for (const [prefix, items] of groups) {
    const catLabel = categories[prefix] ?? prefix;
    lines.push(`| ${prefix} | ${catLabel} | ${items.length} |`);
  }

  lines.push('');
  lines.push(`## All ${stats.total} Defects`);
  lines.push('');
  lines.push('| ID | GitHub Issue | Severity |');
  lines.push('|----|-------------|----------|');
  for (const p of patches) {
    const ghText = p.github ? `${p.github} ${p.title}` : p.title;
    const ghLink = p.githubUrl ? `[${ghText}](${p.githubUrl})` : ghText;
    lines.push(`| ${p.id} | ${ghLink} | ${p.severity} |`);
  }

  return lines.join('\n');
}

// ── Main ──

let anyChanged = false;

function report(changed, label) {
  if (!changed) return;
  anyChanged = true;
  console.log(checkOnly ? `STALE: ${label}` : `Updated: ${label}`);
}

// Sync patch/CLAUDE.md defect tables
report(
  replaceMarkerSection(resolve(ROOT, 'patch', 'CLAUDE.md'), 'defect-tables', generateClaudeTables()),
  'patch/CLAUDE.md (defect tables)'
);

if (!anyChanged) {
  console.log('All files are up to date.');
} else if (checkOnly) {
  console.log('\nFiles are out of date. Run: npm run preflight');
  process.exit(1);
}
