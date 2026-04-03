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

// ── Topological levels (ADR-0014, B3: read from publish-levels.json) ──

// Hardcoded fallback in case publish-levels.json is unreadable
const FALLBACK_LEVELS = [
  [
    '@sparkleideas/agentdb',
    '@sparkleideas/agentic-flow',
    '@sparkleideas/ruv-swarm',
    '@sparkleideas/agent-booster',
    '@sparkleideas/agentdb-onnx',
  ],
  [
    '@sparkleideas/shared',
    '@sparkleideas/memory',
    '@sparkleideas/embeddings',
    '@sparkleideas/codex',
    '@sparkleideas/aidefence',
  ],
  [
    '@sparkleideas/neural',
    '@sparkleideas/hooks',
    '@sparkleideas/browser',
    '@sparkleideas/plugins',
    '@sparkleideas/providers',
    '@sparkleideas/claims',
    '@sparkleideas/ruvector-upstream',
  ],
  [
    '@sparkleideas/guidance',
    '@sparkleideas/mcp',
    '@sparkleideas/integration',
    '@sparkleideas/deployment',
    '@sparkleideas/swarm',
    '@sparkleideas/security',
    '@sparkleideas/performance',
    '@sparkleideas/testing',
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
  [
    '@sparkleideas/cli',
    '@sparkleideas/claude-flow',
  ],
];

function loadLevelsFromJson() {
  const levelsFile = resolve(
    import.meta.url.startsWith('file://')
      ? new URL('.', import.meta.url).pathname
      : '.',
    '..', 'config', 'publish-levels.json'
  );
  try {
    const data = JSON.parse(readFileSync(levelsFile, 'utf-8'));
    if (!data.levels || !Array.isArray(data.levels) || data.levels.length === 0) {
      throw new Error('publish-levels.json has no valid levels array');
    }
    return data.levels.map(l => l.packages);
  } catch (err) {
    console.warn(`Warning: could not load publish-levels.json: ${err.message}`);
    console.warn('Falling back to hardcoded LEVELS');
    return null;
  }
}

export const LEVELS = loadLevelsFromJson() || FALLBACK_LEVELS;

// Rate limit between levels: 0 for local Verdaccio, 2000 for real npm
// Local publishes don't need rate limiting — saves ~10s across 5 levels
export const RATE_LIMIT_MS = 0;

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
            // Prefer non-private packages over private ones (e.g. ruvector
            // root is private: true but npm/packages/ruvector/ is publishable).
            // For non-private duplicates, prefer parent over npm/ subdirectory.
            const existing = map.get(pkg.name);
            const existingPkg = existing
              ? JSON.parse(readFileSync(resolve(existing, 'package.json'), 'utf-8'))
              : null;
            if (!existing || existingPkg?.private || (!pkg.private && !dir.includes('/npm/'))) {
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
 * Check if a package has ever been published to the registry.
 * Returns 'latest' always — no prerelease gate needed for local Verdaccio.
 */
async function getPublishTag(packageName) {
  try {
    const registry = process.env.NPM_CONFIG_REGISTRY || 'http://localhost:4873';
    await execFile('npm', ['view', packageName, 'version', '--registry', registry], {
      timeout: 30_000,
    });
    return 'latest';
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
  // Also normalize bin paths: strip leading "./" (npm 11.x warns about it)
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [name, binPath] of Object.entries(pkg.bin)) {
      const normalized = binPath.replace(/^\.\//, '');
      const resolved = join(pkgDir, normalized);
      try {
        statSync(resolved);
        if (binPath !== normalized) {
          pkg.bin[name] = normalized;
        }
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
export async function publishAll(buildDir, { dryRun = false, metadata, getPublishTagFn, rateLimitMs, packagesFilter, noSave = false, provenance = false } = {}) {
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

  // Pre-resolve publish tags for all packages in parallel (batch registry checks).
  // Each getPublishTag call is an npm view roundtrip (~500ms). Doing 40+ packages
  // serially inside publishOne wastes ~20s. Batch them all upfront.
  const tagCache = new Map();
  async function prefetchTags(packageNames) {
    const resolveTag = getPublishTagFn || getPublishTag;
    const uncached = packageNames.filter(n => !tagCache.has(n));
    if (uncached.length === 0) return;
    const results = await Promise.allSettled(
      uncached.map(async (name) => {
        const tag = await resolveTag(name);
        return { name, tag };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        tagCache.set(r.value.name, { ok: true, tag: r.value.tag });
      } else {
        // Store the error so publishOne can report it per-package
        const name = uncached[results.indexOf(r)];
        tagCache.set(name, { ok: false, error: r.reason });
      }
    }
  }

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

    const pkgStart = Date.now();
    console.log(`  ${pkgName} @ ${effectiveVersion}`);
    if (!dryRun) {
      // stampVersion still strips missing bin entries and adds sparkleideas metadata
      stampVersion(pkgDir, effectiveVersion, metadata);
    }

    // Use pre-fetched tag from parallel batch
    const cached = tagCache.get(pkgName);
    let tag;
    if (cached && !cached.ok) {
      const errorMsg = `Failed to check npm registry for ${pkgName}: ${cached.error?.message || 'unknown'}`;
      console.error(`  ERROR: ${errorMsg}`);
      return { ok: false, error: { package: pkgName, level: levelNumber, error: errorMsg } };
    }
    tag = cached?.tag ?? null;

    const tagLabel = tag ?? 'latest (first publish)';
    console.log(`    tag: ${tagLabel}`);

    if (dryRun) {
      console.log(`    [dry-run] would run: npm publish${tag ? ` --tag ${tag}` : ''}`);
      const entry = { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: effectiveVersion, duration_ms: Date.now() - pkgStart };
      publishedVersions[pkgName] = effectiveVersion;
      return { ok: true, entry };
    }

    const publishRegistry = process.env.NPM_CONFIG_REGISTRY || 'http://localhost:4873';
    const publishArgs = ['publish', '--access', 'public', '--ignore-scripts',
      '--registry', publishRegistry];
    if (provenance) {
      publishArgs.push('--provenance');
    }
    // ADR-0015: first publish uses --tag latest (npm requires --tag for prerelease
    // versions). Subsequent publishes use --tag prerelease (ADR-0010 gate).
    publishArgs.push('--tag', tag ?? 'latest');

    try {
      const { stdout } = await execFile('npm', publishArgs, {
        cwd: pkgDir,
        timeout: 120_000,
      });
      if (stdout) console.log(`    ${stdout.trim()}`);
      const duration_ms = Date.now() - pkgStart;
      console.log(`    published in ${duration_ms}ms`);
      publishedVersions[pkgName] = effectiveVersion;
      return { ok: true, entry: { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: effectiveVersion, duration_ms } };
    } catch (err) {
      const stderr = err.stderr || '';
      const stderrLower = stderr.toLowerCase();
      if (
        stderrLower.includes('cannot publish over previously published version') ||
        stderrLower.includes('you cannot publish over the previously published versions') ||
        stderrLower.includes('this package is already present')
      ) {
        // Verify the version actually exists on the target registry before skipping.
        // Without this check, a failed publish to one registry (e.g. Verdaccio from
        // a previous test) could be mistaken for a successful publish to npm.
        let verified = false;
        try {
          await execFile('npm', ['view', `${pkgName}@${effectiveVersion}`, 'version',
            '--registry', publishRegistry], { timeout: 15_000 });
          verified = true;
        } catch {
          verified = false;
        }
        if (verified) {
          console.log(`    already published — skipping (${Date.now() - pkgStart}ms)`);
          publishedVersions[pkgName] = effectiveVersion;
          return { ok: true, entry: { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: effectiveVersion, duration_ms: Date.now() - pkgStart } };
        }
        // Version does NOT exist on target registry — ghost version.
        // npm accepted the write but never propagated to read side.
        // Bump to next -patch.N and retry up to 5 times.
        console.warn(`    ghost version detected: ${pkgName}@${effectiveVersion} — bumping and retrying`);
        const MAX_GHOST_RETRIES = 5;
        let retryVersion = effectiveVersion;
        let ghostResolved = false;
        for (let attempt = 1; attempt <= MAX_GHOST_RETRIES && !ghostResolved; attempt++) {
          const patchMatch = retryVersion.match(/^(.*)-patch\.(\d+)$/);
          if (!patchMatch) break;
          retryVersion = `${patchMatch[1]}-patch.${parseInt(patchMatch[2], 10) + 1}`;
          console.log(`    retrying as ${pkgName}@${retryVersion} (attempt ${attempt}/${MAX_GHOST_RETRIES})`);
          pkgJson.version = retryVersion;
          writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
          stampVersion(pkgDir, retryVersion, metadata);
          try {
            const { stdout: retryOut } = await execFile('npm', publishArgs, {
              cwd: pkgDir,
              timeout: 120_000,
            });
            if (retryOut) console.log(`    ${retryOut.trim()}`);
            const duration_ms = Date.now() - pkgStart;
            console.log(`    published (ghost retry #${attempt}) in ${duration_ms}ms`);
            publishedVersions[pkgName] = retryVersion;
            ghostResolved = true;
            return { ok: true, entry: { name: pkgName, level: levelNumber, tag: tag ?? 'latest', version: retryVersion, duration_ms } };
          } catch (retryErr) {
            const retryStderr = retryErr.stderr || '';
            if (retryStderr.toLowerCase().includes('cannot publish over previously published version')) {
              console.warn(`    ghost retry #${attempt} hit another ghost — continuing`);
              continue;
            }
            console.error(`    ghost retry #${attempt} failed with unexpected error: ${retryStderr.substring(0, 300)}`);
            break;
          }
        }
        if (!ghostResolved) {
          console.error(`    exhausted ${MAX_GHOST_RETRIES} ghost retries for ${pkgName}`);
        }
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

    // Pre-fetch all registry tags for this level in parallel
    await prefetchTags(levelPackages);

    // Publish all packages within a level concurrently
    const results = await Promise.all(
      levelPackages.map(pkgName => publishOne(pkgName, levelNumber))
    );
    console.log(`  Level ${levelNumber} completed in ${Date.now() - levelStart}ms`);

    // Check results — collect all successes/failures for this level
    let levelFailed = null;
    for (const result of results) {
      if (result.ok) {
        published.push(result.entry);
      } else {
        levelFailed = result.error;
      }
    }

    if (levelFailed) {
      // Save state for successfully published packages before returning failure
      if (!dryRun && !noSave) {
        savePublishedVersions(publishedVersions);
        console.log(`\nSaved partial state (${published.length} packages) before failure`);
      }
      if (!dryRun) {
        await createFailureIssue(levelFailed.package, levelFailed.level, levelFailed.error);
      }
      return { published, failed: levelFailed };
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

  // Write per-package timing data for pipeline instrumentation
  try {
    const timingFile = resolve(
      import.meta.url.startsWith('file://') ? new URL('.', import.meta.url).pathname : '.',
      '..', 'config', '.publish-timing.json'
    );
    writeFileSync(timingFile, JSON.stringify(published, null, 2) + '\n');
  } catch {
    // Non-fatal: timing data is supplementary
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
      'provenance': { type: 'boolean', default: false },
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
  const provenance = values['provenance'];
  const packagesFilter = values['packages'] ? JSON.parse(values['packages']) : null;
  const result = await publishAll(buildDir, { dryRun, rateLimitMs, packagesFilter, noSave, provenance });

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
