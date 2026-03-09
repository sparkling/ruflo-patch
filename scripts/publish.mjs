#!/usr/bin/env node
// scripts/publish.mjs — Publish all packages in topological order.
// Implements ADR-0014 (topological order), ADR-0015 (first-publish bootstrap),
// ADR-0027 (fork migration — versions come from fork package.json).
//
// Usage:
//   node scripts/publish.mjs --build-dir ./dist
//   node scripts/publish.mjs --build-dir ./dist --dry-run
//
// Exported API:
//   import { publishAll } from './publish.mjs';

import { execFile as execFileCb } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const execFile = promisify(execFileCb);

// ── Topological levels (ADR-0014) ──

export const LEVELS = [
  // Level 1: depends only on external @ruvector/* (public npm)
  [
    '@sparkleideas/agentdb',
    '@sparkleideas/agentic-flow',
    '@sparkleideas/ruv-swarm',
    // ADR-0021/0022 Phase 1: no internal deps
    '@sparkleideas/agent-booster',
    '@sparkleideas/agentdb-onnx',
    // ADR-0022 Phase 4: standalone tools
    '@sparkleideas/cuda-wasm',
  ],
  // Level 2: depends on Level 1
  [
    '@sparkleideas/shared',
    '@sparkleideas/memory',
    '@sparkleideas/embeddings',
    '@sparkleideas/codex',
    '@sparkleideas/aidefence',
  ],
  // Level 3: depends on Level 2
  [
    '@sparkleideas/neural',
    '@sparkleideas/hooks',
    '@sparkleideas/browser',
    '@sparkleideas/plugins',
    '@sparkleideas/providers',
    '@sparkleideas/claims',
    // ADR-0022 Phase 3: WASM bridge
    '@sparkleideas/ruvector-upstream',
  ],
  // Level 4: depends on Level 3
  [
    '@sparkleideas/guidance',
    '@sparkleideas/mcp',
    '@sparkleideas/integration',
    '@sparkleideas/deployment',
    '@sparkleideas/swarm',
    '@sparkleideas/security',
    '@sparkleideas/performance',
    '@sparkleideas/testing',
    // ADR-0022 Phase 3: plugins (depend on @sparkleideas/plugins SDK)
    '@sparkleideas/plugin-gastown-bridge',
    '@sparkleideas/plugin-agentic-qe',
    '@sparkleideas/plugin-code-intelligence',
    '@sparkleideas/plugin-cognitive-kernel',
    '@sparkleideas/plugin-financial-risk',
    '@sparkleideas/plugin-healthcare-clinical',
    '@sparkleideas/plugin-hyperbolic-reasoning',
    '@sparkleideas/plugin-legal-contracts',
    '@sparkleideas/plugin-neural-coordination',
    '@sparkleideas/plugin-perf-optimizer',
    '@sparkleideas/plugin-prime-radiant',
    '@sparkleideas/plugin-quantum-optimizer',
    '@sparkleideas/plugin-test-intelligence',
    '@sparkleideas/teammate-plugin',
  ],
  // Level 5: root packages
  // Note: @sparkleideas/ruflo is published separately from the local repo
  // (it's our wrapper package, not an upstream package)
  [
    '@sparkleideas/cli',
    '@sparkleideas/claude-flow',
  ],
];

export const RATE_LIMIT_MS = 2000;

// ── Published versions state file ──

const STATE_FILE = resolve(
  import.meta.url.startsWith('file://')
    ? new URL('.', import.meta.url).pathname
    : '.',
  '..', 'config', 'published-versions.json'
);

function loadPublishedVersions() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function savePublishedVersions(versions) {
  writeFileSync(STATE_FILE, JSON.stringify(versions, null, 2) + '\n');
}

// ── Version computation ──
// ADR-0027: bumpLastSegment, semverCompare, nextVersion removed.
// In the fork model, versions are set directly in fork package.json files
// by fork-version.mjs. publish.mjs reads the version as-is.

// ── Package directory resolution ──

/**
 * Recursively walk buildDir to find all package.json files and build
 * a map of package name -> directory path.
 */
function buildPackageMap(buildDir) {
  const map = new Map();

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === 'node_modules') continue;
      const fullPath = resolve(dir, entry);

      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(fullPath);
      } else if (entry === 'package.json') {
        try {
          const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));
          if (pkg.name) {
            // Skip npm/ subdirectory packages — these are thin wrappers
            // that depend on unpublished @agent-booster/* packages.
            // The parent directory bundles WASM/dist directly.
            const existing = map.get(pkg.name);
            if (!existing || !dir.includes('/npm/')) {
              map.set(pkg.name, dir);
            }
          }
        } catch {
          // Skip malformed package.json files
        }
      }
    }
  }

  walk(resolve(buildDir));
  return map;
}

// ── First-publish detection (ADR-0015) ──

/**
 * Check if a package has ever been published to npm.
 * Returns 'prerelease' for existing packages, null for first-publish.
 * Distinguishes E404 (not found) from network/other errors.
 */
async function getPublishTag(packageName) {
  try {
    await execFile('npm', ['view', packageName, 'version'], {
      timeout: 30_000,
    });
    // Package exists -- use prerelease gate (ADR-0010)
    return 'prerelease';
  } catch (err) {
    const stderr = err.stderr || '';
    const isNotFound =
      stderr.includes('E404') ||
      stderr.includes('is not in this registry') ||
      stderr.includes('Not Found') ||
      err.code === 1;

    if (isNotFound) {
      // Package never published -- first publish sets @latest automatically
      return null;
    }

    // Network error or other npm failure -- propagate
    throw new Error(
      `npm view failed for ${packageName} (not an E404): ${stderr || err.message}`
    );
  }
}

// ── Version stamping ──

/**
 * Update the version field in a package.json file.
 * Also stamps sparkleideas metadata for traceability.
 */
function stampVersion(pkgDir, version, metadata) {
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const upstreamVersion = pkg.version;
  pkg.version = version;
  if (metadata) {
    pkg.sparkleideas = {
      upstreamVersion,
      ...metadata,
    };
  }

  // Strip bin entries that reference non-existent files (prevents npm publish errors)
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [name, binPath] of Object.entries(pkg.bin)) {
      const resolved = join(pkgDir, binPath);
      try {
        statSync(resolved);
      } catch {
        console.log(`    stripped missing bin: ${name} -> ${binPath}`);
        delete pkg.bin[name];
      }
    }
    if (Object.keys(pkg.bin).length === 0) {
      delete pkg.bin;
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return pkg;
}

// ── GitHub issue creation ──

async function createFailureIssue(packageName, levelNumber, errorOutput) {
  const title = `Publish failed: ${packageName} at level ${levelNumber}`;
  const body = [
    `## Publish Failure`,
    '',
    `**Package:** \`${packageName}\``,
    `**Level:** ${levelNumber}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    '',
    `### npm error output`,
    '',
    '```',
    errorOutput.slice(0, 4000), // Truncate to avoid GitHub body limits
    '```',
    '',
    `Packages at levels ${levelNumber + 1}-5 were NOT published.`,
  ].join('\n');

  try {
    await execFile('gh', [
      'issue', 'create',
      '--title', title,
      '--body', body,
      '--label', 'publish-failure',
    ], { timeout: 30_000 });
  } catch (err) {
    // Log but do not throw -- the publish failure is the primary error
    console.error(`Warning: could not create GitHub issue: ${err.message}`);
  }
}

// ── Core publish logic ──

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Publish all packages in topological order.
 *
 * @param {string} buildDir - Root directory containing built package directories
 * @param {object} options
 * @param {boolean} [options.dryRun=false] - Log actions without publishing
 * @param {object} [options.metadata] - Metadata to stamp into each package.json
 * @param {function} [options.getPublishTagFn] - Override getPublishTag (for testing)
 * @param {number} [options.rateLimitMs] - Override RATE_LIMIT_MS (0 for local registries)
 * @returns {{ published: Array<{name: string, level: number, tag: string|null, version: string}>, failed: null | { package: string, level: number, error: string } }}
 */
export async function publishAll(buildDir, { dryRun = false, metadata, getPublishTagFn, rateLimitMs, packagesFilter, noSave = false } = {}) {
  if (!buildDir) throw new Error('buildDir is required');

  const resolvedBuildDir = resolve(buildDir);
  console.log(`Resolving packages in: ${resolvedBuildDir}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  const packageMap = buildPackageMap(resolvedBuildDir);
  console.log(`Found ${packageMap.size} packages in build directory`);

  // Load per-package version state
  const publishedVersions = loadPublishedVersions();

  const published = [];

  // Publish one package. Returns { ok, entry?, error? }.
  async function publishOne(pkgName, levelNumber) {
    const pkgDir = packageMap.get(pkgName);
    if (!pkgDir) {
      const errorMsg = `Package directory not found for ${pkgName} in ${resolvedBuildDir}`;
      console.error(errorMsg);
      return { ok: false, error: { package: pkgName, level: levelNumber, error: errorMsg } };
    }

    const pkgJsonPath = join(pkgDir, 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    // ADR-0027: version is already set correctly in the fork's package.json
    const effectiveVersion = pkgJson.version;

    console.log(`  ${pkgName} @ ${effectiveVersion}`);
    if (!dryRun) {
      // stampVersion still strips missing bin entries and adds sparkleideas metadata
      stampVersion(pkgDir, effectiveVersion, metadata);
    }

    const resolveTag = getPublishTagFn || getPublishTag;
    let tag;
    try {
      tag = await resolveTag(pkgName);
    } catch (err) {
      const errorMsg = `Failed to check npm registry for ${pkgName}: ${err.message}`;
      console.error(`  ERROR: ${errorMsg}`);
      return { ok: false, error: { package: pkgName, level: levelNumber, error: errorMsg } };
    }

    const tagLabel = tag ?? 'latest (first publish)';
    console.log(`    tag: ${tagLabel}`);

    if (dryRun) {
      console.log(`    [dry-run] would run: npm publish${tag ? ` --tag ${tag}` : ''}`);
      const entry = { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: effectiveVersion };
      publishedVersions[pkgName] = effectiveVersion;
      return { ok: true, entry };
    }

    const publishArgs = ['publish', '--access', 'public', '--ignore-scripts'];
    // ADR-0015: first publish uses --tag latest (npm requires --tag for prerelease
    // versions). Subsequent publishes use --tag prerelease (ADR-0010 gate).
    publishArgs.push('--tag', tag ?? 'latest');

    try {
      const { stdout } = await execFile('npm', publishArgs, {
        cwd: pkgDir,
        timeout: 120_000,
      });
      if (stdout) console.log(`    ${stdout.trim()}`);
      publishedVersions[pkgName] = effectiveVersion;
      return { ok: true, entry: { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: effectiveVersion } };
    } catch (err) {
      const stderr = err.stderr || '';
      const stderrLower = stderr.toLowerCase();
      if (
        stderrLower.includes('cannot publish over previously published version') ||
        stderrLower.includes('you cannot publish over the previously published versions') ||
        stderrLower.includes('this package is already present')
      ) {
        console.log(`    already published — skipping`);
        publishedVersions[pkgName] = effectiveVersion;
        return { ok: true, entry: { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: effectiveVersion } };
      }

      const errorOutput = [
        `Exit code: ${err.code}`,
        `stdout: ${err.stdout || '(empty)'}`,
        `stderr: ${stderr || '(empty)'}`,
      ].join('\n');
      console.error(`  FAILED: ${pkgName}`);
      console.error(`    ${errorOutput}`);
      return { ok: false, error: { package: pkgName, level: levelNumber, error: errorOutput } };
    }
  }

  const effectiveRateLimit = rateLimitMs ?? RATE_LIMIT_MS;

  for (const [levelIndex, packages] of LEVELS.entries()) {
    const levelNumber = levelIndex + 1;
    const levelStart = Date.now();

    const levelPackages = packagesFilter
      ? packages.filter(p => packagesFilter.includes(p))
      : packages;

    if (levelPackages.length === 0) {
      console.log(`\n--- Level ${levelNumber} (skipped — no changed packages) ---`);
      continue;
    }

    console.log(`\n--- Level ${levelNumber} (${levelPackages.length}/${packages.length} packages) ---`);

    // Publish all packages within a level concurrently
    const results = await Promise.all(
      levelPackages.map(pkgName => publishOne(pkgName, levelNumber))
    );
    console.log(`  Level ${levelNumber} completed in ${Date.now() - levelStart}ms`);

    // Check results — first failure stops the pipeline
    for (const result of results) {
      if (result.ok) {
        published.push(result.entry);
      } else {
        if (!dryRun) {
          await createFailureIssue(result.error.package, result.error.level, result.error.error);
        }
        return { published, failed: result.error };
      }
    }

    // Rate limit between levels (not between packages within a level)
    const isLastLevel = levelIndex === LEVELS.length - 1;
    if (!isLastLevel && !dryRun && effectiveRateLimit > 0) {
      await sleep(effectiveRateLimit);
    }
  }

  // Save updated published versions state
  if (!dryRun && !noSave) {
    savePublishedVersions(publishedVersions);
    console.log(`\nUpdated config/published-versions.json`);
  } else if (noSave) {
    console.log(`\nSkipped saving config/published-versions.json (--no-save)`);
  }

  console.log(`\nPublished ${published.length} packages successfully.`);
  return { published, failed: null };
}

// ── CLI entry point ──

async function main() {
  const { values } = parseArgs({
    options: {
      'build-dir': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-rate-limit': { type: 'boolean', default: false },
      'no-save': { type: 'boolean', default: false },
      'packages': { type: 'string' },
    },
    strict: true,
  });

  const buildDir = values['build-dir'];
  const dryRun = values['dry-run'];

  if (!buildDir) {
    console.error('Usage: node scripts/publish.mjs --build-dir <dir> [--dry-run] [--no-rate-limit] [--packages \'["@sparkleideas/cli"]\']');
    process.exit(1);
  }

  const rateLimitMs = values['no-rate-limit'] ? 0 : undefined;
  const noSave = values['no-save'];
  const packagesFilter = values['packages'] ? JSON.parse(values['packages']) : null;
  const result = await publishAll(buildDir, { dryRun, rateLimitMs, packagesFilter, noSave });

  // Output JSON summary to stdout
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(result, null, 2));

  if (result.failed) {
    process.exit(1);
  }
}

// Run CLI if this is the main module
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(__filename);

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
