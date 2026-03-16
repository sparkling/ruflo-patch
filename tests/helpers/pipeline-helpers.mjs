// tests/helpers/pipeline-helpers.mjs
// Pure functions extracted from pipeline logic (ADR-0011, ADR-0012, ADR-0015).
// These are importable by pipeline scripts (via node -e) and publish.mjs,
// and directly testable without git or npm calls.

/**
 * Compute the next version for a package.
 * ADR-0012 (rewritten): bump the last numeric segment of max(upstream, lastPublished).
 *
 * @param {string} upstreamVersion - Current upstream package version (e.g. "3.0.2")
 * @param {string|null} lastPublished - Last published version, or null if never published
 * @returns {{ version: string }}
 */
export function computeVersion(upstreamVersion, lastPublished) {
  // Import the canonical implementation
  // For test isolation, we re-implement the logic here
  const max = !lastPublished ? upstreamVersion
    : semverCompare(upstreamVersion, lastPublished) >= 0 ? upstreamVersion
    : lastPublished;
  return {
    version: bumpLastSegment(max),
  };
}

/**
 * Bump the last numeric segment of a version string by 1.
 */
function bumpLastSegment(version) {
  const match = version.match(/^(.*?)(\d+)$/);
  if (!match) {
    // Version ends with a non-numeric identifier (e.g., "2.0.2-alpha")
    return `${version}.1`;
  }
  return `${match[1]}${parseInt(match[2], 10) + 1}`;
}

/**
 * Compare two semver version strings.
 */
function semverCompare(a, b) {
  const parseVer = (v) => {
    const dashIdx = v.indexOf('-');
    if (dashIdx === -1) return { core: v, pre: null };
    return { core: v.slice(0, dashIdx), pre: v.slice(dashIdx + 1) };
  };

  const va = parseVer(a);
  const vb = parseVer(b);

  const partsA = va.core.split('.').map(Number);
  const partsB = vb.core.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const na = partsA[i] || 0;
    const nb = partsB[i] || 0;
    if (na !== nb) return na - nb;
  }

  if (va.pre === null && vb.pre === null) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;

  const preA = va.pre.split('.');
  const preB = vb.pre.split('.');
  const preLen = Math.max(preA.length, preB.length);
  for (let i = 0; i < preLen; i++) {
    if (i >= preA.length) return -1;
    if (i >= preB.length) return 1;
    const isNumA = /^\d+$/.test(preA[i]);
    const isNumB = /^\d+$/.test(preB[i]);
    if (isNumA && isNumB) {
      const diff = parseInt(preA[i], 10) - parseInt(preB[i], 10);
      if (diff !== 0) return diff;
    } else if (isNumA !== isNumB) {
      return isNumA ? -1 : 1;
    } else {
      if (preA[i] < preB[i]) return -1;
      if (preA[i] > preB[i]) return 1;
    }
  }
  return 0;
}

/**
 * Parse the .last-build-state file content into a structured object.
 * Format: KEY=VALUE lines (shell-compatible).
 *
 * @param {string} content - Raw file content
 * @returns {{ rufloHead: string, agenticFlowHead: string, ruvFannHead: string,
 *             localCommit: string, buildTimestamp: string, buildVersion: string } | null}
 */
export function parseState(content) {
  if (!content || typeof content !== 'string') return null;

  const map = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    map[key] = value;
  }

  return {
    rufloHead: map.RUFLO_HEAD || '',
    agenticFlowHead: map.AGENTIC_FLOW_HEAD || '',
    ruvFannHead: map.RUV_FANN_HEAD || '',
    localCommit: map.LOCAL_COMMIT || '',
    buildTimestamp: map.BUILD_TIMESTAMP || '',
    buildVersion: map.BUILD_VERSION || '',
  };
}

/**
 * Serialize a state object back to the .last-build-state file format.
 *
 * @param {{ rufloHead: string, agenticFlowHead: string, ruvFannHead: string,
 *           localCommit: string, buildTimestamp: string, buildVersion: string }} state
 * @returns {string}
 */
export function serializeState(state) {
  return [
    `RUFLO_HEAD=${state.rufloHead}`,
    `AGENTIC_FLOW_HEAD=${state.agenticFlowHead}`,
    `RUV_FANN_HEAD=${state.ruvFannHead}`,
    `LOCAL_COMMIT=${state.localCommit}`,
    `BUILD_TIMESTAMP=${state.buildTimestamp}`,
    `BUILD_VERSION=${state.buildVersion}`,
  ].join('\n') + '\n';
}

/**
 * Detect whether a build is needed by comparing current heads to last state.
 * ADR-0011: build triggers on upstream HEAD change OR local commit change.
 *
 * @param {{ rufloHead: string, agenticFlowHead: string, ruvFannHead: string,
 *           localCommit: string }} currentHeads
 * @param {{ rufloHead: string, agenticFlowHead: string, ruvFannHead: string,
 *           localCommit: string } | null} lastState - null if no previous state
 * @returns {{ shouldBuild: boolean, reasons: string[] }}
 */
export function detectChanges(currentHeads, lastState) {
  // No previous state means first build ever
  if (lastState == null) {
    return { shouldBuild: true, reasons: ['No previous build state (first build)'] };
  }

  const reasons = [];

  if (currentHeads.rufloHead !== lastState.rufloHead) {
    reasons.push(`Upstream ruflo changed: ${lastState.rufloHead} -> ${currentHeads.rufloHead}`);
  }
  if (currentHeads.agenticFlowHead !== lastState.agenticFlowHead) {
    reasons.push(`Upstream agentic-flow changed: ${lastState.agenticFlowHead} -> ${currentHeads.agenticFlowHead}`);
  }
  if (currentHeads.ruvFannHead !== lastState.ruvFannHead) {
    reasons.push(`Upstream ruv-FANN changed: ${lastState.ruvFannHead} -> ${currentHeads.ruvFannHead}`);
  }
  if (currentHeads.localCommit !== lastState.localCommit) {
    reasons.push(`Local commit changed: ${lastState.localCommit} -> ${currentHeads.localCommit}`);
  }

  return {
    shouldBuild: reasons.length > 0,
    reasons,
  };
}

/**
 * Determine the npm publish tag based on whether the package exists.
 * ADR-0015: first publish uses no tag (npm defaults to "latest"),
 * subsequent publishes use "prerelease".
 *
 * @param {function} npmViewFn - async function(packageName) that resolves to
 *   version string if package exists, or throws with code 'E404' if not found,
 *   or throws with other error on network failure.
 * @param {string} packageName
 * @returns {Promise<string|null>} 'prerelease' if already published, null if first publish
 * @throws {Error} on network errors (non-E404 failures)
 */
export async function getPublishTag(npmViewFn, packageName) {
  try {
    await npmViewFn(packageName);
    return 'prerelease';
  } catch (err) {
    if (err && err.code === 'E404') {
      return null;
    }
    throw err;
  }
}
