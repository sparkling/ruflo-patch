// @tier unit
// ADR-0094 Sprint 0 WI-2: _escape_json correctness tests.
//
// Regression target: catalog ingest choked at pos 109089 because the
// previous _escape_json implementation only handled \n/\r/\t/\\/\"
// but left bare ASCII control chars (0x01..0x1F minus those 5) and DEL
// (0x7F) in the output. RFC 8259 JSON requires those be \uXXXX escaped.
//
// The implementation under test is a bash function in
// lib/acceptance-harness.sh. We drive it via a one-shot bash subshell
// per case (source + echo) and parse the stdout back as JSON — if the
// output is valid JSON, the escape worked; if JSON.parse throws, we
// regressed.
//
// Strategy
// --------
// For every case: (a) the bash output must start with `"` and end with `"`,
// (b) `JSON.parse` must accept the result, (c) the round-trip value equals
// the (truncated) input. Truncation is at 4096 bytes per the helper's
// contract.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');

/**
 * Invoke _escape_json on `input` and return the raw bash stdout.
 * Uses a stub ns/log/elapsed chain so sourcing the harness doesn't fail.
 */
function runEscapeJson(input) {
  // Pass input via argv to avoid shell-quoting pitfalls for control chars.
  // The bash driver reads $1 and hands it to _escape_json verbatim.
  const driver = [
    '#!/usr/bin/env bash',
    'set +u',
    // Stub the required external helpers the harness expects from the caller.
    '_ns() { echo 0; }',
    '_elapsed_ms() { echo 0; }',
    'log() { :; }',
    `source "${HARNESS_FILE}"`,
    // Emit the escaped string verbatim (no trailing newline).
    'printf "%s" "$(_escape_json "$1")"',
  ].join('\n');

  const result = spawnSync(
    'bash',
    ['-c', driver, 'bash', input],
    { encoding: 'utf8', timeout: 10000 },
  );

  if (result.status !== 0) {
    throw new Error(
      `bash driver failed: exit=${result.status} stderr=${result.stderr}`,
    );
  }
  return result.stdout;
}

describe('ADR-0094 Sprint 0 WI-2 — _escape_json static source', () => {
  const source = readFileSync(HARNESS_FILE, 'utf-8');

  it('defines _escape_json', () => {
    assert.match(source, /_escape_json\(\)\s*\{/);
  });

  it('escapes the 7 canonical short-form chars (\\\\, \\", \\b, \\t, \\n, \\f, \\r)', () => {
    // String.includes avoids the cross-escape-layer regex gymnastics.
    for (const snippet of [
      `s="\${s//\\\\/\\\\\\\\}"`,
      `s="\${s//\\"/\\\\\\"}"`,
      `s="\${s//$'\\b'/\\\\b}"`,
      `s="\${s//$'\\t'/\\\\t}"`,
      `s="\${s//$'\\n'/\\\\n}"`,
      `s="\${s//$'\\f'/\\\\f}"`,
      `s="\${s//$'\\r'/\\\\r}"`,
    ]) {
      assert.ok(source.includes(snippet),
        `_escape_json source must contain literal escape: ${JSON.stringify(snippet)}`);
    }
  });

  it('escapes control chars 0x01..0x1F (minus the 5 short-forms) and 0x7F', () => {
    // Range 0x01..0x1F excluding 0x08 (\b), 0x09 (\t), 0x0A (\n), 0x0C (\f),
    // 0x0D (\r). Plus 0x7F (DEL).
    const required = [
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
      0x0b, 0x0e, 0x0f,
      0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
      0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
      0x7f,
    ];
    for (const cc of required) {
      const hex = cc.toString(16).padStart(2, '0');
      const re = new RegExp(`\\\\u00${hex}`, 'i');
      assert.match(source, re,
        `must emit \\u00${hex.padStart(2, '0')} for 0x${hex}`);
    }
  });

  it('truncates to 4096 bytes to bound worst-case CPU', () => {
    assert.match(source, /\$\{s:0:4096\}/,
      'must cap input at 4096 bytes before escape loop');
  });
});

describe('ADR-0094 Sprint 0 WI-2 — _escape_json behaviour', () => {
  it('escapes a plain ASCII string as a quoted JSON string', () => {
    const out = runEscapeJson('hello world');
    assert.equal(out, '"hello world"');
    assert.equal(JSON.parse(out), 'hello world');
  });

  it('escapes tab / newline / carriage-return via short forms', () => {
    const out = runEscapeJson('foo\tbar\nbaz\rqux');
    assert.equal(JSON.parse(out), 'foo\tbar\nbaz\rqux');
  });

  it('escapes form feed (0x0C) via \\f short form', () => {
    const out = runEscapeJson('a\fb');
    assert.equal(JSON.parse(out), 'a\fb');
    assert.match(out, /\\f/);
  });

  it('escapes backspace (0x08) via \\b short form', () => {
    const out = runEscapeJson('a\bb');
    assert.equal(JSON.parse(out), 'a\bb');
    assert.match(out, /\\b/);
  });

  it('escapes backslash before quote (canonical order — no double-escape)', () => {
    const out = runEscapeJson('a\\b"c');
    assert.equal(JSON.parse(out), 'a\\b"c');
    assert.equal(out, '"a\\\\b\\"c"');
  });

  it('escapes arbitrary control char 0x01 via \\u0001', () => {
    const out = runEscapeJson('x\x01y');
    assert.equal(JSON.parse(out), 'x\x01y');
    assert.match(out, /\\u0001/);
  });

  it('escapes ESC (0x1B) via \\u001b', () => {
    const out = runEscapeJson('a\x1bb');
    assert.equal(JSON.parse(out), 'a\x1bb');
    assert.match(out, /\\u001b/);
  });

  it('escapes DEL (0x7F) via \\u007f', () => {
    const out = runEscapeJson('a\x7fb');
    assert.equal(JSON.parse(out), 'a\x7fb');
    assert.match(out, /\\u007f/);
  });

  it('round-trips a mixed-control payload without corrupting the stream', () => {
    // Simulates catalog ingest: mixed ASCII + common controls + \uXXXX
    // chars. Every byte must round-trip faithfully through JSON.parse.
    const payload = [
      'normal text',
      '\u0001\u0002\u0003 tab\t newline\n',
      'bs\b ff\f cr\r',
      'esc\x1b del\x7f',
      'quote"backslash\\end',
    ].join(' / ');
    const out = runEscapeJson(payload);
    assert.equal(JSON.parse(out), payload);
  });

  it('does not double-escape backslashes (backslash FIRST in order)', () => {
    const out = runEscapeJson('\\n');
    // Input is literally two chars: \ + n. Output must NOT be \n the short form.
    assert.equal(JSON.parse(out), '\\n');
    assert.equal(out, '"\\\\n"');
  });

  it('truncates input at 4096 bytes', () => {
    const big = 'A'.repeat(5000);
    const out = runEscapeJson(big);
    const parsed = JSON.parse(out);
    assert.equal(parsed.length, 4096, 'must truncate to 4096 bytes');
  });

  it('emits a valid JSON string for the pos-109089 reproducer (bare 0x0C)', () => {
    // The historical failure: bare form-feed at an arbitrary offset. Our
    // reproducer puts one at 100 and one at 4000 to stress the bash
    // string-replacement order.
    const payload = 'A'.repeat(100) + '\f' + 'B'.repeat(3800) + '\f' + 'C'.repeat(100);
    const out = runEscapeJson(payload);
    assert.equal(
      JSON.parse(out),
      payload,
      'both form-feeds must survive round-trip',
    );
  });
});
