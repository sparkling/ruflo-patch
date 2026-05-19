// @tier unit
// scripts/check-undiscriminating-catches.mjs — stricter sibling of
// check-silent-catches.mjs. Flags `catch { /* comment */ }` blocks that
// swallow without taking runtime action.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = '/Users/henrik/source/ruflo-patch/scripts/check-undiscriminating-catches.mjs';

function buildDriver(testFile) {
  return `
    import { readFileSync } from 'node:fs';
    const src = readFileSync(${JSON.stringify(testFile)}, 'utf8');

    function stripStringsAndComments(s) {
      let out = ''; let i = 0; let inString = null; let blockC = false; let lineC = false;
      while (i < s.length) {
        const c = s[i]; const nx = s[i+1];
        if (lineC) { if (c==='\\n'){lineC=false; out+=c;} i++; }
        else if (blockC) {
          if (c==='*'&&nx==='/'){blockC=false; out+='  '; i+=2;}
          else if (c==='\\n') { out+='\\n'; i++; }
          else {i++;}
        }
        else if (inString) {
          if (c==='\\\\') { if (nx==='\\n') { out+='\\n'; i+=2; } else i+=2; }
          else if (c===inString){inString=null; out+=c; i++;}
          else if (c==='\\n') { out+='\\n'; i++; }
          else i++;
        }
        else if (c==='/'&&nx==='/') { lineC=true; i+=2; }
        else if (c==='/'&&nx==='*') { blockC=true; i+=2; }
        else if (c==='"'||c==="'"||c==='\`') { inString=c; out+=c; i++; }
        else { out+=c; i++; }
      }
      return out;
    }

    function findUndiscriminatingCatches(src) {
      const stripped = stripStringsAndComments(src);
      const lines = src.split('\\n');
      const findings = [];
      let i = 0;
      while (i < src.length) {
        const idx = src.indexOf('catch', i);
        if (idx === -1) break;
        i = idx + 5;
        if (idx > 0 && /[a-zA-Z0-9_$]/.test(src[idx-1])) continue;
        if (idx + 5 < src.length && /[a-zA-Z0-9_$]/.test(src[idx+5])) continue;
        const lineNum = src.slice(0, idx).split('\\n').length;
        const strippedLine = stripped.split('\\n')[lineNum-1] ?? '';
        if (!/\\bcatch\\b/.test(strippedLine)) continue;
        let j = idx + 5;
        while (j < src.length && /\\s/.test(src[j])) j++;
        if (src[j] === '(') {
          let depth = 1; j++;
          while (j < src.length && depth > 0) {
            if (src[j]==='(') depth++;
            else if (src[j]===')') depth--;
            j++;
          }
          if (depth !== 0) continue;
          while (j < src.length && /\\s/.test(src[j])) j++;
        }
        if (src[j] !== '{') continue;
        const bodyStart = j + 1;
        let depth = 1, k = bodyStart, inStr = null, blockC = false, lineC = false;
        while (k < src.length && depth > 0) {
          const c = src[k]; const nx = src[k+1];
          if (lineC) { if (c==='\\n') lineC=false; k++; continue; }
          if (blockC) { if (c==='*'&&nx==='/') { blockC=false; k+=2; continue; } k++; continue; }
          if (inStr) {
            if (c==='\\\\') { k+=2; continue; }
            if (c===inStr) { inStr=null; k++; continue; }
            k++; continue;
          }
          if (c==='/'&&nx==='/') { lineC=true; k+=2; continue; }
          if (c==='/'&&nx==='*') { blockC=true; k+=2; continue; }
          if (c==='"'||c==="'"||c==='\`') { inStr=c; k++; continue; }
          if (c==='{') depth++;
          else if (c==='}') { depth--; if (depth===0) break; }
          k++;
        }
        if (depth !== 0) continue;
        const origBody = src.slice(bodyStart, k);
        const strippedBody = stripStringsAndComments(origBody).trim();
        if (strippedBody === '') findings.push({ line: lineNum });
        i = k + 1;
      }
      return findings;
    }

    console.log(JSON.stringify(findUndiscriminatingCatches(src)));
  `;
}

function runFixture(content) {
  const sandbox = mkdtempSync(join(tmpdir(), 'undis-catch-'));
  const fixtureFile = join(sandbox, 'fixture.ts');
  writeFileSync(fixtureFile, content);
  const driverFile = join(sandbox, 'driver.mjs');
  writeFileSync(driverFile, buildDriver(fixtureFile));
  try {
    const res = spawnSync('node', [driverFile], { encoding: 'utf8' });
    return { findings: JSON.parse(res.stdout || '[]'), stderr: res.stderr };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

describe('check-undiscriminating-catches — flags swallow-with-comment patterns', () => {
  it('flags `catch { /* explanation */ }` (the comment-only swallow that hid 2026-05-19 ESM bug)', () => {
    const { findings } = runFixture(`
      try { ruvllm.TrainingPipeline; } catch { /* not available */ }
    `);
    assert.equal(findings.length, 1);
  });

  it('flags `catch (e) { /* explanation */ }` (with binding, comment-only)', () => {
    const { findings } = runFixture(`
      try { doX(); } catch (e) { /* best effort cleanup */ }
    `);
    assert.equal(findings.length, 1);
  });

  it('flags `catch { // line comment\\n}` (line comment, no actions)', () => {
    const { findings } = runFixture(`
      try { x() } catch {
        // skip silently
      }
    `);
    assert.equal(findings.length, 1);
  });

  it('flags truly-empty `catch { }` too (superset of silent-catches detector)', () => {
    const { findings } = runFixture(`try { x(); } catch {}`);
    assert.equal(findings.length, 1);
  });
});

describe('check-undiscriminating-catches — does NOT flag discriminating catches', () => {
  it('does not flag catch that re-throws', () => {
    const { findings } = runFixture(`
      try { x() } catch (e) { throw e; }
    `);
    assert.deepEqual(findings, []);
  });

  it('does not flag catch that conditionally re-throws', () => {
    const { findings } = runFixture(`
      try { x() } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        // expected: file missing
      }
    `);
    assert.deepEqual(findings, []);
  });

  it('does not flag catch that logs', () => {
    const { findings } = runFixture(`
      try { x() } catch (e) { console.warn('failed', e); }
    `);
    assert.deepEqual(findings, []);
  });

  it('does not flag catch that returns a sentinel', () => {
    const { findings } = runFixture(`
      function f() {
        try { return doX(); } catch { return null; }
      }
    `);
    assert.deepEqual(findings, []);
  });

  it('does not flag catch that calls an ignore-helper', () => {
    const { findings } = runFixture(`
      try { x() } catch (e) { ignoreError(e); }
    `);
    assert.deepEqual(findings, []);
  });

  it('does not flag catch that uses an instanceof discriminator', () => {
    const { findings } = runFixture(`
      try { x() } catch (e) {
        if (e instanceof TypeError) throw e;
        recover(e);
      }
    `);
    assert.deepEqual(findings, []);
  });
});

describe('check-undiscriminating-catches — false-positive guards', () => {
  it('does not flag `catch` inside a string literal', () => {
    const { findings } = runFixture(`
      const example = "try { x() } catch {}";
    `);
    assert.deepEqual(findings, []);
  });

  it('does not flag `catch` inside a block comment', () => {
    const { findings } = runFixture(`
      /*
        Example: try { x() } catch {}
      */
      const a = 1;
    `);
    assert.deepEqual(findings, []);
  });
});

describe('check-undiscriminating-catches — script file is present', () => {
  it('the detector script exists', () => {
    assert.ok(existsSync(SCRIPT));
  });
});
