// tests/helpers/pipeline-helpers.mjs
// Pure functions extracted from pipeline logic (ADR-0011, ADR-0012, ADR-0015).
// These are importable by sync-and-build.sh (via node -e) and publish.mjs,
// and directly testable without git or npm calls.

/**
 * Compute the ruflo-patch version string.
 * ADR-0012: format is "{upstreamVersion}-patch.{N}"
 * Iteration resets to 1 when upstream version changes.
 *
 * @param {string} upstreamVersion - Current upstream package version (e.g. "3.5.2")
 * @param {string|null} lastUpstreamVersion - Upstream version from last build, or null
 * @param {number} lastIteration - Patch iteration from last build (0 if none)
 * @returns {{ version: string, iteration: number }}
 */
export function computeVersion(upstreamVersion, lastUpstreamVersion, lastIteration) {
  let iteration;
  if (lastUpstreamVersion == null || upstreamVersion !== lastUpstreamVersion) {
    iteration = 1;
  } else {
    iteration = lastIteration + 1;
  }
  return {
    version: `${upstreamVersion}-patch.${iteration}`,
    iteration,
  };
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
