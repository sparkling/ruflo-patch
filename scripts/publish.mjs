#!/usr/bin/env node
// scripts/publish.mjs — Publish all packages in topological order.
// Implements ADR-0014 (topological order), ADR-0015 (first-publish bootstrap),
// ADR-0012 (version numbering — bump-last-segment scheme).
//
// Usage:
//   node scripts/publish.mjs --build-dir ./dist
//   node scripts/publish.mjs --build-dir ./dist --dry-run
//
// Exported API:
//   import { publishAll, nextVersion } from './publish.mjs';

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

// ── Version computation (ADR-0012 rewrite) ──

/**
 * Bump the last numeric segment of a version string by 1.
 * Works for both stable (3.0.2 -> 3.0.3) and prerelease (3.0.0-alpha.6 -> 3.0.0-alpha.7).
 *
 * @param {string} version - A semver version string
 * @returns {string} The version with its last numeric segment incremented
 */
export function bumpLastSegment(version) {
  // Find the last numeric segment and increment it
  const match = version.match(/^(.*?)(\d+)$/);
  if (!match) {
    // Version ends with a non-numeric identifier (e.g., "2.0.2-alpha")
    // Treat as "2.0.2-alpha.0" and bump to "2.0.2-alpha.1"
    return `${version}.1`;
  }
  const prefix = match[1];
  const num = parseInt(match[2], 10);
  return `${prefix}${num + 1}`;
}

/**
 * Compare two semver version strings.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 * Handles prerelease identifiers: 3.0.0-alpha.6 < 3.0.0 < 3.0.1
 */
function semverCompare(a, b) {
  // Split into [core, prerelease]
  const parseVer = (v) => {
    const dashIdx = v.indexOf('-');
    if (dashIdx === -1) return { core: v, pre: null };
    return { core: v.slice(0, dashIdx), pre: v.slice(dashIdx + 1) };
  };

  const va = parseVer(a);
  const vb = parseVer(b);

  // Compare core versions numerically
  const partsA = va.core.split('.').map(Number);
  const partsB = vb.core.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const na = partsA[i] || 0;
    const nb = partsB[i] || 0;
    if (na !== nb) return na - nb;
  }

  // Same core — prerelease < no-prerelease
  if (va.pre === null && vb.pre === null) return 0;
  if (va.pre === null) return 1;   // a is stable, b has prerelease -> a > b
  if (vb.pre === null) return -1;  // b is stable, a has prerelease -> a < b

  // Both have prerelease — compare identifiers
  const preA = va.pre.split('.');
  const preB = vb.pre.split('.');
  const preLen = Math.max(preA.length, preB.length);
  for (let i = 0; i < preLen; i++) {
    if (i >= preA.length) return -1; // fewer identifiers = lower precedence
    if (i >= preB.length) return 1;
    const isNumA = /^\d+$/.test(preA[i]);
    const isNumB = /^\d+$/.test(preB[i]);
    if (isNumA && isNumB) {
      const diff = parseInt(preA[i], 10) - parseInt(preB[i], 10);
      if (diff !== 0) return diff;
    } else if (isNumA !== isNumB) {
      // numeric < string
      return isNumA ? -1 : 1;
    } else {
      // both strings — lexicographic
      if (preA[i] < preB[i]) return -1;
      if (preA[i] > preB[i]) return 1;
    }
  }
  return 0;
}

/**
 * Compute the next version for a package.
 * Formula: bumpLastSegment( max(upstreamVersion, lastPublished) )
 *
 * @param {string} upstreamVersion - The version in the package's upstream package.json
 * @param {string|undefined} lastPublished - The last version we published, or undefined
 * @returns {string} The next version to publish
 */
export function nextVersion(upstreamVersion, lastPublished) {
  if (!lastPublished) {
    return bumpLastSegment(upstreamVersion);
  }
  const max = semverCompare(upstreamVersion, lastPublished) >= 0
    ? upstreamVersion
    : lastPublished;
  return bumpLastSegment(max);
}

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
            map.set(pkg.name, dir);
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
export async function publishAll(buildDir, { dryRun = false, metadata, getPublishTagFn, rateLimitMs } = {}) {
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

  for (const [levelIndex, packages] of LEVELS.entries()) {
    const levelNumber = levelIndex + 1;
    console.log(`\n--- Level ${levelNumber} ---`);

    for (const pkgName of packages) {
      const pkgDir = packageMap.get(pkgName);
      if (!pkgDir) {
        const errorMsg = `Package directory not found for ${pkgName} in ${resolvedBuildDir}`;
        console.error(errorMsg);

        if (!dryRun) {
          await createFailureIssue(pkgName, levelNumber, errorMsg);
        }

        return {
          published,
          failed: { package: pkgName, level: levelNumber, error: errorMsg },
        };
      }

      // Read the package's own package.json to determine upstream version
      const pkgJsonPath = join(pkgDir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const upstreamVersion = pkgJson.version;

      // Compute next version using per-package tracking
      const lastPublished = publishedVersions[pkgName];
      const effectiveVersion = nextVersion(upstreamVersion, lastPublished);

      // Stamp version
      console.log(`  ${pkgName} @ ${effectiveVersion} (upstream: ${upstreamVersion}, last: ${lastPublished || '(none)'})`);
      if (!dryRun) {
        stampVersion(pkgDir, effectiveVersion, metadata);
      }

      // Determine publish tag (first-publish bootstrap)
      const resolveTag = getPublishTagFn || getPublishTag;
      let tag;
      try {
        tag = await resolveTag(pkgName);
      } catch (err) {
        const errorMsg = `Failed to check npm registry for ${pkgName}: ${err.message}`;
        console.error(`  ERROR: ${errorMsg}`);

        if (!dryRun) {
          await createFailureIssue(pkgName, levelNumber, errorMsg);
        }

        return {
          published,
          failed: { package: pkgName, level: levelNumber, error: errorMsg },
        };
      }

      const tagLabel = tag ?? 'latest (first publish)';
      console.log(`    tag: ${tagLabel}`);

      if (dryRun) {
        console.log(`    [dry-run] would run: npm publish${tag ? ` --tag ${tag}` : ''}`);
        published.push({
          name: pkgName,
          level: levelNumber,
          tag: tag ?? 'latest',
          version: effectiveVersion,
        });
      } else {
        // Build npm publish args
        // --ignore-scripts prevents prepublishOnly from re-running build steps
        const publishArgs = ['publish', '--access', 'public', '--ignore-scripts'];
        // npm requires --tag for any version with a prerelease identifier (contains '-')
        // For first-publish packages (tag is null), use 'prerelease' if the version
        // has a prerelease suffix, otherwise omit --tag to set 'latest'
        const effectiveTag = tag ?? (effectiveVersion.includes('-') ? 'prerelease' : null);
        if (effectiveTag) {
          publishArgs.push('--tag', effectiveTag);
        }

        try {
          const { stdout, stderr } = await execFile('npm', publishArgs, {
            cwd: pkgDir,
            timeout: 120_000,
          });

          if (stdout) console.log(`    ${stdout.trim()}`);

          // Update published versions state
          publishedVersions[pkgName] = effectiveVersion;

          published.push({
            name: pkgName,
            level: levelNumber,
            tag: tag ?? 'latest',
            version: effectiveVersion,
          });
        } catch (err) {
          const stderr = err.stderr || '';
          // Treat "already published" as a skip, not a failure
          if (
            stderr.includes('cannot publish over previously published version') ||
            stderr.includes('You cannot publish over the previously published versions')
          ) {
            console.log(`    already published — skipping`);
            // Still record the version
            publishedVersions[pkgName] = effectiveVersion;
            published.push({
              name: pkgName,
              level: levelNumber,
              tag: effectiveTag ?? 'latest',
              version: effectiveVersion,
            });
          } else {
            const errorOutput = [
              `Exit code: ${err.code}`,
              `stdout: ${err.stdout || '(empty)'}`,
              `stderr: ${stderr || '(empty)'}`,
            ].join('\n');

            console.error(`  FAILED: ${pkgName}`);
            console.error(`    ${errorOutput}`);

            await createFailureIssue(pkgName, levelNumber, errorOutput);

            return {
              published,
              failed: { package: pkgName, level: levelNumber, error: errorOutput },
            };
          }
        }
      }

      // Rate limit buffer (skip after last package)
      const isLast =
        levelIndex === LEVELS.length - 1 &&
        pkgName === packages[packages.length - 1];

      const effectiveRateLimit = rateLimitMs ?? RATE_LIMIT_MS;
      if (!isLast && !dryRun && effectiveRateLimit > 0) {
        await sleep(effectiveRateLimit);
      }
    }
  }

  // Save updated published versions state
  if (!dryRun) {
    savePublishedVersions(publishedVersions);
    console.log(`\nUpdated config/published-versions.json`);
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
    },
    strict: true,
  });

  const buildDir = values['build-dir'];
  const dryRun = values['dry-run'];

  if (!buildDir) {
    console.error('Usage: node scripts/publish.mjs --build-dir <dir> [--dry-run] [--no-rate-limit]');
    process.exit(1);
  }

  const rateLimitMs = values['no-rate-limit'] ? 0 : undefined;
  const result = await publishAll(buildDir, { dryRun, rateLimitMs });

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
