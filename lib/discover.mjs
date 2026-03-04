#!/usr/bin/env node
// lib/discover.mjs — Dynamic patch discovery
// Scans patch/*/ directories, parses README.md + fix.py headers for metadata.
// Single source of truth for scripts, sentinel checks, and documentation.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PATCH_DIR = resolve(ROOT, 'patch');

// Category labels from lib/categories.json
const CATEGORY_MAP = JSON.parse(
  readFileSync(resolve(__dirname, 'categories.json'), 'utf-8')
);

/**
 * Parse a patch README.md for doc metadata.
 * Expected format:
 *   # {ID}: {title}
 *   **Severity**: {severity}
 *   **GitHub**: [{label}]({url})
 *   ## Files Patched
 *   - {file}
 *   ## Ops
 *   {N} op(s) in fix.py
 */
function parseReadme(readmePath, dirName) {
  const text = readFileSync(readmePath, 'utf-8');
  const lines = text.split('\n');

  const titleMatch = lines[0]?.match(/^#\s+(\S+):\s+(.+)/);
  const stripped = dirName.replace(/^\d+-/, '');
  const id = titleMatch?.[1] ?? stripped.split('-').slice(0, 2).join('-');
  const title = titleMatch?.[2]?.trim() ?? '';

  const sevLine = lines.find(l => l.startsWith('**Severity**'));
  const severity = sevLine?.match(/\*\*Severity\*\*:\s*(\S+)/)?.[1] ?? 'Unknown';

  const ghLine = lines.find(l => l.startsWith('**GitHub**'));
  const ghMatch = ghLine?.match(/\[([^\]]+)\]\(([^)]+)\)/);
  const github = ghMatch?.[1] ?? '';
  const githubUrl = ghMatch?.[2] ?? '';

  const filesIdx = lines.findIndex(l => /^##\s+Files Patched/i.test(l));
  const files = [];
  if (filesIdx >= 0) {
    for (let i = filesIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^-\s+`?([^`\n]+)`?\s*$/);
      if (m) files.push(m[1].trim());
      else if (lines[i].startsWith('#') || (lines[i].trim() === '' && files.length > 0)) break;
    }
  }

  const opsLine = lines.find(l => /^\d+\s+ops?\b/i.test(l));
  const ops = opsLine ? parseInt(opsLine, 10) : 0;

  return { id, title, severity, github, githubUrl, files, ops };
}

/**
 * Parse a sentinel file for verification metadata.
 */
function parseSentinels(sentinelPath) {
  const text = readFileSync(sentinelPath, 'utf-8');
  const lines = text.split('\n');

  let pkg = null;
  const sentinels = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('package:')) {
      pkg = trimmed.replace('package:', '').trim();
    } else if (trimmed === 'none') {
      sentinels.push({ type: 'none' });
    } else {
      const absentMatch = trimmed.match(/^absent\s+"(.+)"\s+(.+)$/);
      if (absentMatch) {
        sentinels.push({ type: 'absent', pattern: absentMatch[1], file: absentMatch[2] });
        continue;
      }
      const grepMatch = trimmed.match(/^grep\s+"(.+)"\s+(.+)$/);
      if (grepMatch) {
        sentinels.push({ type: 'grep', pattern: grepMatch[1], file: grepMatch[2] });
      }
    }
  }

  return { package: pkg, sentinels };
}

/**
 * Discover all patches. Returns structured JSON with everything needed
 * by scripts, sentinel checks, and documentation.
 */
export function discover() {
  let dirs;
  try {
    dirs = readdirSync(PATCH_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {
    return { patches: [], categories: {}, stats: { total: 0, categories: 0 } };
  }

  const patches = [];
  const categorySet = new Set();

  for (const dirName of dirs) {
    const readmePath = resolve(PATCH_DIR, dirName, 'README.md');
    if (!existsSync(readmePath)) continue;

    const meta = parseReadme(readmePath, dirName);
    const prefix = meta.id.split('-')[0];
    const stripped = dirName.replace(/^\d+-/, '');
    const slug = stripped.replace(/^[A-Z]+-\d+-/, '');
    const orderMatch = dirName.match(/^(\d+)-/);
    const order = orderMatch ? parseInt(orderMatch[1], 10) : null;
    const hasPy = existsSync(resolve(PATCH_DIR, dirName, 'fix.py'));
    const hasSh = existsSync(resolve(PATCH_DIR, dirName, 'fix.sh'));
    const fixType = hasPy ? 'python' : hasSh ? 'shell' : 'unknown';
    const category = CATEGORY_MAP[prefix] ?? prefix;
    categorySet.add(category);

    const sentinelPath = resolve(PATCH_DIR, dirName, 'sentinel');
    const sentinel = existsSync(sentinelPath) ? parseSentinels(sentinelPath) : { package: null, sentinels: [] };

    patches.push({
      id: meta.id,
      order,
      slug,
      dir: dirName,
      title: meta.title,
      severity: meta.severity,
      github: meta.github,
      githubUrl: meta.githubUrl,
      category,
      prefix,
      type: fixType,
      files: meta.files,
      ops: meta.ops,
      package: sentinel.package,
      sentinels: sentinel.sentinels,
    });
  }

  const categories = {};
  for (const p of patches) {
    if (!categories[p.prefix]) {
      categories[p.prefix] = CATEGORY_MAP[p.prefix] ?? p.prefix;
    }
  }

  return {
    patches,
    categories,
    stats: {
      total: patches.length,
      categories: categorySet.size,
    },
  };
}

// CLI: `node lib/discover.mjs` prints JSON to stdout
const thisFile = resolve(__dirname, 'discover.mjs');
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  console.log(JSON.stringify(discover(), null, 2));
}
