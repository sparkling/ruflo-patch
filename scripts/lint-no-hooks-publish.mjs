#!/usr/bin/env node
/**
 * ADR-0203 publish-set guard (ruflo-patch side).
 *
 * Asserts config/publish-levels.json — THE canonical publish gate per
 * scripts/publish.mjs loadLevels() — never lists "@sparkleideas/hooks".
 * The dead @claude-flow/hooks package was eliminated (ADR-0203); a future
 * upstream re-merge that re-adds it to the publish set must fail loud here
 * rather than silently re-shipping the dead package.
 *
 * The fork-source half of this guard (no @claude-flow/hooks imports, no
 * declare-module stub) lives in the fork arch-test
 * (@claude-flow/cli/__tests__/arch/hooks-dead-package.arch.test.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLISH_LEVELS = resolve(__dirname, '../config/publish-levels.json');
const FORBIDDEN = '@sparkleideas/hooks';

const data = JSON.parse(readFileSync(PUBLISH_LEVELS, 'utf8'));
const allPkgs = (data.levels ?? []).flatMap((l) => l.packages ?? []);

if (allPkgs.includes(FORBIDDEN)) {
  console.error(
    `[FAIL] lint-no-hooks-publish: "${FORBIDDEN}" is back in config/publish-levels.json.\n` +
      '       The dead @claude-flow/hooks package was eliminated per ADR-0203 and must not be republished.\n' +
      '       Remove it from publish-levels.json (and re-check the fork arch-test).',
  );
  process.exit(1);
}

console.log('[INFO] lint-no-hooks-publish: OK — publish-levels.json has no @sparkleideas/hooks (ADR-0203).');
