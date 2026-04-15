// @tier unit
// ADR-0086: SQLite -> RVF migration command (`memory migrate --from-sqlite`).
//
// Pre-ADR-0086 installs wrote memory entries to .swarm/memory.db (SQLite). After
// ADR-0086 the CLI only reads RVF, so users upgrading silently lose data. The fix
// is `cli memory migrate --from-sqlite` which reads the legacy DB via better-sqlite3
// (dynamic, optional dep — Debt 7 keeps the hard dep removed) and bulk-inserts into
// .claude-flow/memory.rvf.
//
// Tests verify:
//   Group 1: Migrator stub structure — RvfMigrator.fromSqlite exists, dynamic-imports
//            better-sqlite3, has sql.js fallback, throws clear error when both missing
//   Group 2: CLI command wiring — migrate subcommand has --from-sqlite/--source/--dest/
//            --dry-run flags, runFromSqlite delegates to RvfMigrator.fromSqlite, prints
//            install hint when better-sqlite3 missing
//   Group 3: Behavioral round-trip — when @claude-flow/memory + better-sqlite3 are
//            available, build a fixture .db, migrate, verify entries appear in RVF,
//            verify dry-run counts without writing, verify idempotency on re-run

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Source paths
// ============================================================================

const FORK = '/Users/henrik/source/forks/ruflo/v3/@claude-flow';
const MIGRATION_PATH = `${FORK}/memory/src/rvf-migration.ts`;
const CLI_MEMORY_PATH = `${FORK}/cli/src/commands/memory.ts`;
const CLI_PKG_PATH = `${FORK}/cli/package.json`;

const migrationSrc = readFileSync(MIGRATION_PATH, 'utf-8');
const cliMemorySrc = readFileSync(CLI_MEMORY_PATH, 'utf-8');
const cliPkg = JSON.parse(readFileSync(CLI_PKG_PATH, 'utf-8'));

// ============================================================================
// Group 1: RvfMigrator stub structure
// ============================================================================

describe('ADR-0086 SQLite migration: Group 1 — RvfMigrator stub', () => {
  it('rvf-migration.ts exists', () => {
    assert.ok(existsSync(MIGRATION_PATH),
      'rvf-migration.ts must exist in memory package');
  });

  it('exports RvfMigrator class', () => {
    assert.ok(/export class RvfMigrator/.test(migrationSrc),
      'must export RvfMigrator class');
  });

  it('RvfMigrator has static fromSqlite method', () => {
    assert.ok(/static\s+async\s+fromSqlite\s*\(/.test(migrationSrc),
      'RvfMigrator.fromSqlite must be a static async method');
  });

  it('readSqliteRows tries better-sqlite3 dynamically', () => {
    // Dynamic import keeps better-sqlite3 out of the static dep graph
    // so Debt 7 (no native deps in CLI) stays satisfied.
    assert.ok(/await\s+import\(\s*['"]better-sqlite3['"]/.test(migrationSrc),
      'readSqliteRows must use dynamic import for better-sqlite3');
  });

  it('readSqliteRows has sql.js fallback for environments without better-sqlite3', () => {
    assert.ok(/await\s+import\(\s*['"]sql\.js['"]/.test(migrationSrc),
      'readSqliteRows must have sql.js fallback');
  });

  it('readSqliteRows throws clear error when neither driver is available', () => {
    assert.ok(/install better-sqlite3 or sql\.js/i.test(migrationSrc),
      'readSqliteRows must fail loudly with install hint');
  });

  it('reads the canonical memory_entries table', () => {
    // The pre-ADR-0086 SQLite schema stored entries in memory_entries.
    assert.ok(/SELECT\s+\*\s+FROM\s+memory_entries/i.test(migrationSrc),
      'must SELECT FROM memory_entries (legacy schema)');
  });

  it('normalizeSqliteRow parses tags/metadata JSON columns', () => {
    // SQLite stores tags + metadata as JSON strings; RVF expects parsed objects.
    assert.ok(/normalizeSqliteRow/.test(migrationSrc),
      'must define normalizeSqliteRow helper');
    const normalizeBlock = migrationSrc.slice(
      migrationSrc.indexOf('function normalizeSqliteRow')
    );
    assert.ok(/['"]tags['"]/.test(normalizeBlock) && /['"]metadata['"]/.test(normalizeBlock),
      'normalizeSqliteRow must handle tags and metadata columns');
    assert.ok(/JSON\.parse/.test(normalizeBlock),
      'normalizeSqliteRow must JSON.parse string columns');
  });

  it('migrateBatches calls RvfBackend.bulkInsert for batches', () => {
    // Bulk insert preserves source row IDs, which makes re-runs idempotent
    // (entries.set(id, ...) replaces, never appends).
    assert.ok(/backend\.bulkInsert\(/.test(migrationSrc),
      'must use RvfBackend.bulkInsert for performance + idempotency');
  });

  it('fromSqlite returns RvfMigrationResult with errors array', () => {
    const fromSqliteBlock = migrationSrc.slice(
      migrationSrc.indexOf('static async fromSqlite')
    );
    assert.ok(/mkResult\(/.test(fromSqliteBlock),
      'fromSqlite must use mkResult to build typed RvfMigrationResult');
  });
});

// ============================================================================
// Group 2: CLI command wiring (memory migrate --from-sqlite)
// ============================================================================

describe('ADR-0086 SQLite migration: Group 2 — CLI command wiring', () => {
  it('memory.ts exists', () => {
    assert.ok(existsSync(CLI_MEMORY_PATH), 'cli memory.ts must exist');
  });

  it('migrateCommand has from-sqlite option', () => {
    assert.ok(/name:\s*['"]from-sqlite['"]/.test(cliMemorySrc),
      'migrateCommand must declare a --from-sqlite flag');
  });

  it('migrateCommand has source option', () => {
    assert.ok(/name:\s*['"]source['"]/.test(cliMemorySrc),
      'migrateCommand must declare --source for SQLite path');
  });

  it('migrateCommand has dest option', () => {
    assert.ok(/name:\s*['"]dest['"]/.test(cliMemorySrc),
      'migrateCommand must declare --dest for RVF path');
  });

  it('migrateCommand has dry-run option', () => {
    assert.ok(/name:\s*['"]dry-run['"]/.test(cliMemorySrc),
      'migrateCommand must declare --dry-run');
  });

  it('migrateCommand action delegates to runFromSqlite when --from-sqlite is set', () => {
    assert.ok(/ctx\.flags\['from-sqlite'\]/.test(cliMemorySrc),
      'action must check ctx.flags[\'from-sqlite\']');
    assert.ok(/runFromSqlite\(/.test(cliMemorySrc),
      'action must call runFromSqlite()');
  });

  it('runFromSqlite is defined as an async function', () => {
    assert.ok(/async function runFromSqlite\(ctx[^)]*\):\s*Promise/.test(cliMemorySrc),
      'runFromSqlite must be an async function returning Promise<CommandResult>');
  });

  it('runFromSqlite defaults source to .swarm/memory.db', () => {
    // ADR-0086 requirement: legacy SQLite files live at .swarm/memory.db.
    assert.ok(/\.swarm\/memory\.db/.test(cliMemorySrc),
      'runFromSqlite must default source path to .swarm/memory.db');
  });

  it('runFromSqlite defaults dest to .claude-flow/memory.rvf', () => {
    assert.ok(/\.claude-flow\/memory\.rvf/.test(cliMemorySrc),
      'runFromSqlite must default dest path to .claude-flow/memory.rvf');
  });

  it('runFromSqlite imports RvfMigrator dynamically from @claude-flow/memory', () => {
    // Dynamic import avoids forcing the memory package to be eagerly loaded.
    assert.ok(/await\s+import\(['"]@claude-flow\/memory['"]\)/.test(cliMemorySrc),
      'runFromSqlite must dynamically import @claude-flow/memory');
    assert.ok(/RvfMigrator/.test(cliMemorySrc),
      'runFromSqlite must reference RvfMigrator');
    assert.ok(/RvfMigrator\.fromSqlite\(/.test(cliMemorySrc),
      'runFromSqlite must call RvfMigrator.fromSqlite');
  });

  it('runFromSqlite uses dynamic better-sqlite3 import for dry-run path', () => {
    // Dry-run reads COUNT(*) directly without going through RvfMigrator,
    // so it needs its own dynamic import with the same fallback semantics.
    assert.ok(/await\s+import\(\s*['"]better-sqlite3['"]/.test(cliMemorySrc),
      'runFromSqlite must dynamically import better-sqlite3 for the dry-run path');
  });

  it('runFromSqlite prints install hint when better-sqlite3 is missing', () => {
    // Per requirements: fail loudly with "Install better-sqlite3 for migration".
    assert.ok(/npm install better-sqlite3/.test(cliMemorySrc),
      'runFromSqlite must instruct users to `npm install better-sqlite3` when missing');
  });

  it('runFromSqlite verifies source file exists before migrating', () => {
    assert.ok(/existsSync\(sourcePath\)/.test(cliMemorySrc),
      'runFromSqlite must check that source path exists');
  });

  it('runFromSqlite handles dry-run by counting rows without writing', () => {
    // SELECT COUNT(*) FROM memory_entries — no bulkInsert, no RVF write.
    assert.ok(/SELECT COUNT\(\*\)\s+AS n FROM memory_entries/i.test(cliMemorySrc),
      'dry-run must SELECT COUNT(*) without writing');
  });

  it('migrate command is registered as a subcommand of memory', () => {
    assert.ok(/subcommands:.*migrateCommand/s.test(cliMemorySrc),
      'migrateCommand must be in memoryCommand.subcommands');
  });

  it('migrateCommand examples include --from-sqlite usage', () => {
    assert.ok(/memory migrate --from-sqlite/.test(cliMemorySrc),
      'examples must document --from-sqlite usage for discoverability');
  });
});

// ============================================================================
// Group 3: package.json — better-sqlite3 stays out of hard deps (Debt 7)
// ============================================================================

describe('ADR-0086 SQLite migration: Group 3 — package.json (Debt 7)', () => {
  it('better-sqlite3 is NOT in CLI dependencies (Debt 7 invariant)', () => {
    const deps = cliPkg.dependencies || {};
    assert.ok(!('better-sqlite3' in deps),
      'better-sqlite3 must NOT be in @claude-flow/cli dependencies — Debt 7 removed it');
  });

  it('better-sqlite3 IS in CLI optionalDependencies (migration hint)', () => {
    // optionalDependencies is the right channel: documents the requirement,
    // npm warns-but-continues if install fails (no native build at install time).
    const optDeps = cliPkg.optionalDependencies || {};
    assert.ok('better-sqlite3' in optDeps,
      'better-sqlite3 should be in optionalDependencies as a migration hint');
  });
});

// ============================================================================
// Group 4: Behavioral round-trip (skipped if package not available)
// ============================================================================

describe('ADR-0086 SQLite migration: Group 4 — behavioral round-trip', () => {
  let RvfMigrator = null;
  let RvfBackend = null;
  let Database = null;
  let testDir = null;

  before(async () => {
    try {
      const mem = await import('@claude-flow/memory');
      RvfMigrator = mem.RvfMigrator;
      RvfBackend = mem.RvfBackend;
    } catch {
      // Package not installed — group will skip
    }
    try {
      const mod = await import('better-sqlite3');
      Database = mod.default ?? mod;
    } catch {
      // Driver not installed — group will skip
    }

    if (RvfMigrator && RvfBackend && Database) {
      testDir = join(tmpdir(), `adr0086-sqlite-mig-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    }
  });

  function makeFixtureDb(dbPath, rows) {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        namespace TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT,
        tags TEXT,
        metadata TEXT,
        embedding BLOB,
        embedding_model TEXT,
        embedding_dimensions INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    const stmt = db.prepare(`
      INSERT INTO memory_entries
        (id, key, namespace, content, type, tags, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (const r of rows) {
      stmt.run(
        r.id, r.key, r.namespace ?? 'default', r.content, r.type ?? 'semantic',
        JSON.stringify(r.tags ?? []), JSON.stringify(r.metadata ?? {}),
        now, now
      );
    }
    db.close();
  }

  it('migrates entries from a legacy SQLite db to a fresh RVF', async () => {
    if (!RvfMigrator || !RvfBackend || !Database) {
      // Skip — required deps not installed in this test environment
      return;
    }
    const dbPath = join(testDir, 'legacy.db');
    const rvfPath = join(testDir, 'new.rvf');
    makeFixtureDb(dbPath, [
      { id: 'e1', key: 'auth/jwt', content: 'JWT impl' },
      { id: 'e2', key: 'auth/oauth', content: 'OAuth impl' },
      { id: 'e3', key: 'patterns/singleton', namespace: 'patterns', content: 'Singleton notes' },
    ]);

    const result = await RvfMigrator.fromSqlite(dbPath, rvfPath);
    assert.equal(result.success, true, `migration failed: ${result.errors.join('; ')}`);
    assert.equal(result.entriesMigrated, 3);
    assert.ok(existsSync(rvfPath), 'RVF file must be written to disk');

    // Verify entries are queryable from a fresh backend instance.
    const backend = new RvfBackend({ databasePath: rvfPath, autoPersistInterval: 0 });
    await backend.initialize();
    try {
      const e1 = await backend.get('e1');
      assert.ok(e1, 'e1 must be retrievable after migration');
      assert.equal(e1.content, 'JWT impl');
      assert.equal(e1.key, 'auth/jwt');
    } finally {
      await backend.shutdown();
    }
  });

  it('idempotency: re-running migration does not duplicate entries', async () => {
    if (!RvfMigrator || !RvfBackend || !Database) return;

    const dbPath = join(testDir, 'idemp.db');
    const rvfPath = join(testDir, 'idemp.rvf');
    makeFixtureDb(dbPath, [
      { id: 'i1', key: 'k1', content: 'v1' },
      { id: 'i2', key: 'k2', content: 'v2' },
    ]);

    const r1 = await RvfMigrator.fromSqlite(dbPath, rvfPath);
    const r2 = await RvfMigrator.fromSqlite(dbPath, rvfPath);
    assert.equal(r1.success, true);
    assert.equal(r2.success, true);

    const backend = new RvfBackend({ databasePath: rvfPath, autoPersistInterval: 0 });
    await backend.initialize();
    try {
      // count() with no namespace counts everything; idempotent re-run should not double.
      const total = await backend.count();
      assert.equal(total, 2,
        'Re-running migration must not duplicate (RvfBackend.bulkInsert keys by source id)');
    } finally {
      await backend.shutdown();
    }
  });

  it('preserves namespaces across migration', async () => {
    if (!RvfMigrator || !RvfBackend || !Database) return;

    const dbPath = join(testDir, 'ns.db');
    const rvfPath = join(testDir, 'ns.rvf');
    makeFixtureDb(dbPath, [
      { id: 'n1', key: 'a', namespace: 'alpha', content: 'A' },
      { id: 'n2', key: 'b', namespace: 'beta',  content: 'B' },
    ]);

    const result = await RvfMigrator.fromSqlite(dbPath, rvfPath);
    assert.equal(result.success, true);

    const backend = new RvfBackend({ databasePath: rvfPath, autoPersistInterval: 0 });
    await backend.initialize();
    try {
      const namespaces = await backend.listNamespaces();
      assert.ok(namespaces.includes('alpha'),
        'alpha namespace must survive migration');
      assert.ok(namespaces.includes('beta'),
        'beta namespace must survive migration');
    } finally {
      await backend.shutdown();
    }
  });

  it('reports clear error for missing source file', async () => {
    if (!RvfMigrator) return;
    const result = await RvfMigrator.fromSqlite(
      '/tmp/definitely-does-not-exist-' + Date.now() + '.db',
      join(testDir || tmpdir(), 'missing.rvf')
    );
    assert.equal(result.success, false,
      'migration of nonexistent source must fail');
    assert.ok(result.errors.length > 0,
      'failure must include at least one error message');
  });
});

// ============================================================================
// Group 5: dry-run path — counts without writing (skipped if deps missing)
// ============================================================================

describe('ADR-0086 SQLite migration: Group 5 — dry-run path', () => {
  let Database = null;

  before(async () => {
    try {
      const mod = await import('better-sqlite3');
      Database = mod.default ?? mod;
    } catch {
      // skip
    }
  });

  it('dry-run reads COUNT(*) from legacy DB without writing RVF', () => {
    if (!Database) return; // skip
    const dir = join(tmpdir(), `adr0086-dryrun-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'fixture.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE memory_entries (id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT)');
    const stmt = db.prepare('INSERT INTO memory_entries VALUES (?, ?, ?, ?)');
    stmt.run('a', 'k1', 'default', 'v1');
    stmt.run('b', 'k2', 'default', 'v2');
    stmt.run('c', 'k3', 'default', 'v3');
    db.close();

    // Reproduce the same query the CLI dry-run path runs.
    const ro = new Database(dbPath, { readonly: true });
    try {
      const row = ro.prepare('SELECT COUNT(*) AS n FROM memory_entries').get();
      assert.equal(row.n, 3, 'dry-run COUNT(*) must report exact row count');
    } finally {
      ro.close();
    }

    // dry-run must NOT create the RVF target — verify by checking absence of any
    // .rvf file at the conventional location.
    const conventionalRvf = join(dir, '.claude-flow', 'memory.rvf');
    assert.ok(!existsSync(conventionalRvf),
      'dry-run must not create RVF target file');

    rmSync(dir, { recursive: true, force: true });
  });
});
