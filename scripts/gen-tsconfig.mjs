#!/usr/bin/env node
// scripts/gen-tsconfig.mjs — Standalone tsconfig generator (ADR-0039)
//
// Generates a standalone tsconfig.build.json for a single package, resolving
// extends, stripping composite/references, mapping sibling @sparkleideas/*
// to dist declarations, and injecting stub paths from the tsc toolchain.
//
// Usage: node scripts/gen-tsconfig.mjs --pkg-dir <dir> --tsc-dir <dir> --output <file>

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, relative, basename } from 'path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pkg-dir' && argv[i + 1]) args.pkgDir = argv[++i];
    else if (argv[i] === '--tsc-dir' && argv[i + 1]) args.tscDir = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) args.output = argv[++i];
  }
  if (!args.pkgDir || !args.tscDir || !args.output) {
    console.error('Usage: node gen-tsconfig.mjs --pkg-dir <dir> --tsc-dir <dir> --output <file>');
    process.exit(1);
  }
  return args;
}

function generateTsconfig(pkgDir, tscDir) {
  const tsconfigPath = join(pkgDir, 'tsconfig.json');
  const ts = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));

  // Strip project references (we build standalone)
  delete ts.references;
  delete ts.compilerOptions?.composite;
  if (ts.extends) {
    try {
      const base = JSON.parse(readFileSync(resolve(pkgDir, ts.extends), 'utf-8'));
      ts.compilerOptions = { ...base.compilerOptions, ...ts.compilerOptions };
      delete ts.extends;
    } catch { /* ignore missing base */ }
  }
  delete ts.compilerOptions.composite;
  ts.compilerOptions.skipLibCheck = true;
  ts.compilerOptions.noEmit = false;

  // Preserve original rootDir if set (e.g. './src' -> dist/index.js)
  if (!ts.compilerOptions.rootDir) ts.compilerOptions.rootDir = '.';

  // Exclude test files from compilation (they import vitest which isn't installed)
  if (!ts.exclude) ts.exclude = [];
  ts.exclude.push('**/*.test.ts', '**/*.spec.ts', '**/__tests__/**');

  // Map sibling @sparkleideas/* packages to their dist/ declarations.
  // IMPORTANT: use dist/*.d.ts (not src/*.ts) to avoid rootDir violations
  // when paths resolve to files outside this package's rootDir.
  const v3cf = resolve(pkgDir, '..'); // v3/@claude-flow parent
  if (existsSync(v3cf)) {
    if (!ts.compilerOptions.paths) ts.compilerOptions.paths = {};
    if (!ts.compilerOptions.baseUrl) ts.compilerOptions.baseUrl = '.';
    for (const sibling of readdirSync(v3cf)) {
      const sibDir = join(v3cf, sibling);
      const sibPkg = join(sibDir, 'package.json');
      if (!existsSync(sibPkg)) continue;
      try {
        const sp = JSON.parse(readFileSync(sibPkg, 'utf-8'));
        if (sp.name && sp.name.startsWith('@sparkleideas/')) {
          // Prefer dist/ declarations (avoids rootDir violations)
          const distIndex = join(sibDir, 'dist', 'index.d.ts');
          const distSrcIndex = join(sibDir, 'dist', 'src', 'index.d.ts');
          if (existsSync(distIndex)) {
            ts.compilerOptions.paths[sp.name] = [relative(pkgDir, distIndex)];
          } else if (existsSync(distSrcIndex)) {
            ts.compilerOptions.paths[sp.name] = [relative(pkgDir, distSrcIndex)];
          }
          // No dist/ yet — skip mapping (deps build first in build_order, dist/ persists)
        }
      } catch { /* ignore unreadable sibling */ }
    }
  }

  // Stub commonly missing optional modules.
  // Filename convention: module_name.d.ts -> module/name
  //   agentic-flow_embeddings.d.ts -> agentic-flow/embeddings
  //   @ruvector_attention -> prefix @ then: ruvector/attention
  // Scoped packages: filename starts with @ (e.g. @ruvector_attention.d.ts)
  const stubDir = join(tscDir, 'stubs');
  if (existsSync(stubDir)) {
    if (!ts.compilerOptions.paths) ts.compilerOptions.paths = {};
    for (const stub of readdirSync(stubDir).filter(f => f.endsWith('.d.ts'))) {
      let modName = stub.replace('.d.ts', '');
      // Split on first _ to get scope/name for scoped packages
      const firstUnderscore = modName.indexOf('_');
      if (firstUnderscore > 0) {
        modName = modName.substring(0, firstUnderscore) + '/' + modName.substring(firstUnderscore + 1).replace(/_/g, '/');
      }
      if (!ts.compilerOptions.paths[modName]) {
        ts.compilerOptions.paths[modName] = [resolve(stubDir, stub)];
      }
    }
  }

  // Add @types from tsc toolchain (express, cors, fs-extra, zod@3)
  if (!ts.compilerOptions.typeRoots) ts.compilerOptions.typeRoots = [];
  ts.compilerOptions.typeRoots.push(join(tscDir, 'node_modules/@types'));
  ts.compilerOptions.typeRoots.push('./node_modules/@types');

  // Resolve zod from tsc toolchain (v3) instead of /tmp/node_modules (v4)
  if (!ts.compilerOptions.paths) ts.compilerOptions.paths = {};
  ts.compilerOptions.paths['zod'] = [join(tscDir, 'node_modules/zod/index.d.ts')];

  // Enable downlevelIteration for MapIterator support
  ts.compilerOptions.downlevelIteration = true;

  // Note: moduleResolution stays as 'bundler' (original). Bare specifier stubs
  // (express, cors, etc.) are installed as real @types in the tsc toolchain.

  return ts;
}

const args = parseArgs(process.argv);
const tsconfig = generateTsconfig(args.pkgDir, args.tscDir);
writeFileSync(args.output, JSON.stringify(tsconfig, null, 2));
