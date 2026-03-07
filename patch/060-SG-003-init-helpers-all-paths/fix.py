# SG-003: Init missing helpers for --dual, --minimal, hooks, and upgrade paths
# Ported from claude-flow-patch (270-SG-003-init-helpers-all-paths)
#
# Root cause:
# 1. init --dual bypasses executeInit() entirely — no .claude/helpers/ created
# 2. init --minimal and init hooks set components.helpers=false but settings=true
#    so settings.json references helpers that don't exist
# 3. executeUpgrade() only upgrades 3 of 8 helpers (missing router/session/memory)
# 4. helpers-generator.js generates hook-handler.cjs with require('router.js')
#    instead of require('router.cjs'), failing with "type":"module"
#
# 4 ops: dual path (init.js), settings guard (executor.js),
#         upgrade helpers (executor.js x2)

# Op 1: init --dual should also generate Claude Code infrastructure
# After codex init succeeds, call executeInit() for helpers/settings/statusline
patch("SG-003a: --dual also generates helpers + settings via executeInit",
    INIT_CMD,
    """    // If codex mode, use the Codex initializer
    if (codexMode || dualMode) {
        return initCodexAction(ctx, { codexMode, dualMode, force, minimal, full });
    }""",
    """    // If codex mode, use the Codex initializer
    if (codexMode || dualMode) {
        const codexResult = await initCodexAction(ctx, { codexMode, dualMode, force, minimal, full });
        // SG-003: --dual must also create Claude Code infrastructure (.claude/helpers + settings)
        if (dualMode) {
            try {
                await executeInit({
                    ...DEFAULT_INIT_OPTIONS,
                    targetDir: cwd,
                    force,
                    components: {
                        settings: true,
                        helpers: true,
                        statusline: true,
                        skills: true,
                        commands: true,
                        agents: true,
                        mcp: true,
                        runtime: false,
                        claudeMd: false,
                    },
                });
            } catch { /* T4: non-fatal — codex init already succeeded */ }
        }
        return codexResult;
    }""")

# Op 2: When settings is generated but helpers component is off, still generate
# the critical helpers that settings.json references
patch("SG-003b: generate critical helpers when settings references them",
    EXECUTOR,
    """        // Generate helpers
        if (options.components.helpers) {
            await writeHelpers(targetDir, options, result);
        }""",
    """        // Generate helpers
        if (options.components.helpers) {
            await writeHelpers(targetDir, options, result);
        }
        // SG-003: If settings will be generated but helpers were skipped,
        // generate the critical helpers that settings.json hooks reference
        else if (options.components.settings) {
            const hDir = path.join(targetDir, '.claude', 'helpers');
            fs.mkdirSync(hDir, { recursive: true });
            const criticalForSettings = {
                'hook-handler.cjs': generateHookHandler(),
                'auto-memory-hook.mjs': generateAutoMemoryHook(),
            };
            for (const [name, content] of Object.entries(criticalForSettings)) {
                const fp = path.join(hDir, name);
                if (!fs.existsSync(fp)) {
                    fs.writeFileSync(fp, content, 'utf-8');
                    try { fs.chmodSync(fp, '755'); } catch { /* T4: chmod is best-effort */ }
                    result.created.files.push(`.claude/helpers/${name}`);
                }
            }
        }""")

# Op 3: Fix executeUpgrade() fallback — replace generateIntelligenceStub() → intelligenceContent
patch("SG-003j: upgrade fallback uses intelligenceContent",
    EXECUTOR,
    """            const generatedCritical = {
                'hook-handler.cjs': generateHookHandler(),
                'intelligence.cjs': generateIntelligenceStub(),
                'auto-memory-hook.mjs': generateAutoMemoryHook(),
            };""",
    """            const generatedCritical = {
                'hook-handler.cjs': generateHookHandler(),
                'intelligence.cjs': intelligenceContent,
                'auto-memory-hook.mjs': generateAutoMemoryHook(),
            };""")

# Op 4: Transition — update caches that already have old SG-003a (skills: false)
patch("SG-003l: --dual enables skills/commands/agents (transition)",
    INIT_CMD,
    """                        skills: false,
                        commands: false,
                        agents: false,
                        mcp: true,
                        runtime: false,
                        claudeMd: false,
                    },
                });
            } catch { /* T4: non-fatal — codex init already succeeded */ }""",
    """                        skills: true,
                        commands: true,
                        agents: true,
                        mcp: true,
                        runtime: false,
                        claudeMd: false,
                    },
                });
            } catch { /* T4: non-fatal — codex init already succeeded */ }""")
