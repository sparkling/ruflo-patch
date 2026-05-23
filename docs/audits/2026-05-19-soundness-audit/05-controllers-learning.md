# 05 — Controllers: Learning (LearningSystem / NightlyLearner / SONA / MicroLoRA / EWC++ / SARSA / LearningBridge)

Audit slice: agent 05 (static, read-only) per ADR-0201.
Working tree state: `forks/agentdb` (post-ADR-0161 fork-of-record for learning controllers), `forks/ruvector/crates/sona` (Rust EWC++ / MicroLoRA), `forks/agentic-flow` (autopilot Phase 4 bridge per ADR-0195), `forks/ruflo/v3/@claude-flow/memory` (LearningBridge + neural caller).

## Files inspected

- `/Users/henrik/source/forks/agentdb/src/controllers/LearningSystem.ts` (1369 lines)
- `/Users/henrik/source/forks/agentdb/src/controllers/NightlyLearner.ts` (793 lines)
- `/Users/henrik/source/forks/agentdb/src/services/SonaTrajectoryService.ts` (805 lines)
- `/Users/henrik/source/forks/agentdb/src/services/federated-learning.ts` (436 lines)
- `/Users/henrik/source/forks/agentdb/src/backends/rvf/SonaLearningBackend.ts` (359 lines)
- `/Users/henrik/source/forks/agentdb/src/backends/rvf/SelfLearningRvfBackend.ts` (491 lines)
- `/Users/henrik/source/forks/agentdb/src/backends/rvf/FederatedSessionManager.ts` (526 lines)
- `/Users/henrik/source/forks/agentdb/src/backends/ruvector/RuVectorLearning.ts`
- `/Users/henrik/source/forks/agentdb/src/archivist/handlers/ruvllm/sona-adapt.ts`
- `/Users/henrik/source/forks/agentdb/src/archivist/handlers/ruvllm/microlora-adapt.ts`
- `/Users/henrik/source/forks/agentdb/src/mcp/agentdb-mcp-server.ts` (learning tool surface)
- `/Users/henrik/source/forks/ruvector/crates/sona/src/ewc.rs` (500 lines, full EWC++ impl)
- `/Users/henrik/source/forks/ruvector/crates/sona/src/lora.rs` (MicroLoRA + BaseLoRA + LoRAEngine)
- `/Users/henrik/source/forks/ruvector/crates/sona/src/engine.rs`
- `/Users/henrik/source/forks/ruvector/crates/sona/src/loops/coordinator.rs` (EWC wiring)
- `/Users/henrik/source/forks/ruvector/crates/sona/src/loops/background.rs` (EWC update + apply_constraints)
- `/Users/henrik/source/forks/ruvector/crates/sona/src/wasm.rs` (WASM bindings)
- `/Users/henrik/source/forks/ruvector/crates/sona/src/napi.rs`, `napi_simple.rs`
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/learning-bridge.ts` (493 lines)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts` (MicroLoRA / SONA WASM wrapper)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts` (adapt MCP tools)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/neural/src/algorithms/sarsa.ts` (sarsa bug fix verified)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts` (federatedLearningManager wiring)
- `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` (ADR-0195 Phase 4 event bus host)
- `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` (ADR-0195 Phase 4 producer)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0195-autopilot-learning-phase4-cross-controller-bridges.md` (status: implemented 2026-05-19)

## Definitions (per ADR-0201)

- **Sound**: references resolve; types match; no silent fallbacks that mask failures; docstring claims match behaviour.
- **Complete**: feature fully implemented; no `throw new Error('not implemented')`, no mock returns where real work is advertised; documented capability wired end-to-end.

## Findings

### F-05-001 — `NightlyLearner.discover()` is a confirmed stub returning empty array on success path

- File: `/Users/henrik/source/forks/agentdb/src/controllers/NightlyLearner.ts:208-225`
- Severity: HIGH
- Completeness: INCOMPLETE
- Soundness: BROKEN — docstring + return signature lie
- Detail: The method signature is `async discover(config: {...}): Promise<CausalEdge[]>` and the docstring (lines 195-207) describes the full doubly-robust formula. The implementation:
  ```
  const edges: CausalEdge[] = [];
  const count = await this.discoverCausalEdges();
  if (config.dryRun) { return edges; }
  // Return discovered edges (for non-dry runs)
  // Note: In a real implementation, we'd track and return the actual edges created
  return edges;
  ```
  `discoverCausalEdges` DOES the real work (lines 400-499) and returns `discovered` count, but `discover()` discards it and returns an empty array regardless of dryRun. The TODO comment at line 223 (`In a real implementation, we'd track and return the actual edges created`) flags this as known incompleteness. Per [[feedback-no-fallbacks]] callers that destructure `.length` will silently treat every run as no-op.
- Wired-from: MCP server `agentdb_learner_run` tool route (verified in `mcp/agentdb-mcp-server.ts`). Real consumers see empty list.

### F-05-002 — `LearningSystem.calculateActionScores` default-actions fallback returns synthetic `action_1/2/3` triple

- File: `/Users/henrik/source/forks/agentdb/src/controllers/LearningSystem.ts:528-535`
- Severity: MEDIUM
- Soundness: BROKEN — silent fallback per [[feedback-no-fallbacks]]
- Detail: When the session has no `learning_experiences` rows, the code returns three synthetic action records:
  ```
  return [
    { action: 'action_1', score: 0.5 },
    { action: 'action_2', score: 0.4 },
    { action: 'action_3', score: 0.3 },
  ];
  ```
  `predict()` then runs epsilon-greedy over this synthetic action set, which is observationally indistinguishable from a real prediction. A consumer that calls `predict` immediately after `startSession` will get back `{ action: 'action_1', confidence: ~1, qValue: 0.5 }` with no signal that the policy has zero training data. This is the canonical "silent fallback masks empty state" anti-pattern.
- Suggestion (read-only — no change): real fix is `throw new Error('No actions observed yet')` or a typed `Result` discriminator on `ActionPrediction`.

### F-05-003 — `LearningSystem.initializeRuVectorEnhancements` swallows three independent init errors with `console.warn`

- File: `LearningSystem.ts:116-176`
- Severity: MEDIUM
- Soundness: SILENT-FALLBACK
- Detail: Constructor fires `initializeRuVectorEnhancements().catch(err => console.warn(...))` (line 116). Inside, three try/catch blocks each set `gnnEnabled=false`, `sonaEnabled=false`, or `gnnService=null` after a warn. The first catch wraps `RuVectorLearning.initialize()` which itself THROWS a typed error when `@ruvector/gnn` is missing. The TS caller demotes it to a warn. Downstream, `getEngineTypes()` reports `"disabled"` — but every subsequent `predict` / `train` call proceeds against the SQL/embedding path with no signal that the GNN-enhanced path was skipped. Per [[feedback-no-fallbacks]] this matches the pattern "silent fallback that masks broken features." Mitigating context: the intent appears to be optional-module degradation; if so, the calling surface should be `available: boolean` not `enabled: boolean` and consumers should check before invoking.

### F-05-004 — `SonaTrajectoryService.predict` silently swallows native errors and falls through to frequency-based predict

- File: `services/SonaTrajectoryService.ts:274-298`
- Severity: MEDIUM
- Soundness: SILENT-FALLBACK
- Detail: When `this.sona` is initialized (native), `predict` tries `predict` / `selectAction` methods and on any throw or missing-method falls through to `frequencyPredict()`. The catch block (line 291-293) is bare `catch {}` with the comment "Fall through to frequency-based prediction." A native engine throwing here would be observationally indistinguishable from "native engine not installed", which is also the empty-corpus result (`{ action: 'default', confidence: 0.5 }`). Violates [[feedback-no-fallbacks]] — error type discrimination is needed.

### F-05-005 — `SonaTrajectoryService.recordTrajectory` natively-recording catch is also bare

- File: `services/SonaTrajectoryService.ts:227-242`
- Severity: LOW
- Soundness: SILENT-FALLBACK
- Detail: Inner `catch {}` after the native-engine `recordStep` / `record` / `addStep` dispatch (line 239-241). However, the surrounding logic dual-writes to the in-memory Map + SQLite, so durability isn't lost — only the native-engine learning side-effect. The comment `// Also store in-memory for local pattern access` covers half the rationale. Still, the same "silent fallback masks broken native engine" pattern.
- Notable plus: the SQLite write at lines 257-262 explicitly does NOT have a catch — matches [[feedback-best-effort-must-rethrow-fatals]] (corruption / locked-db surfaces). That part is sound.

### F-05-006 — EWC++ Rust impl is complete, sound, and IS invoked by the Rust training loop

- File: `forks/ruvector/crates/sona/src/ewc.rs` (500 lines)
- Files (wiring): `forks/ruvector/crates/sona/src/loops/coordinator.rs:22-72,148-149,173,183-187`; `forks/ruvector/crates/sona/src/loops/background.rs:78-174`
- Severity: NONE (positive finding)
- Soundness: SOUND
- Completeness: COMPLETE
- Detail: `EwcPlusPlus` exposes `update_fisher`, `detect_task_boundary`, `start_new_task`, `apply_constraints`, `regularization_loss`, `consolidate_all_tasks`, `set_lambda`, `importance_scores`. All seven test cases in `mod tests` exercise the round-trip. The `LoopCoordinator` (coordinator.rs:47-72) constructs `EwcPlusPlus::new(EwcConfig { initial_lambda: config.ewc_lambda, .. })` and shares it (Arc<RwLock<>>) into the BackgroundLoop. `BackgroundLoop::run` (background.rs:144-174) reads gradients, calls `ewc.apply_constraints(&gradients)`, conditionally `ewc.start_new_task()` when `detect_task_boundary` fires, then `ewc.update_fisher(&constrained_gradients)`. EWC is genuinely live in the Rust training pipeline.

### F-05-007 — TS-side MicroLoRA / SONA WASM adapt path does NOT invoke EWC penalty (Rust EWC is only reached via the background loop, not via per-call `adapt`)

- Files:
  - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:259-307` (TS WASM wrapper `createMicroLora` / `adapt`)
  - `forks/ruvector/crates/sona/src/engine.rs:69-77` (`SonaEngine.apply_micro_lora`)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:340-357` (`ruvllm_microlora_adapt` MCP tool handler)
  - `forks/ruvector/crates/sona/src/lora.rs:192-229` (`MicroLoRA::accumulate_gradient` / `apply_accumulated`)
- Severity: HIGH (advertised feature gap)
- Soundness: BROKEN (docstring claims, behaviour disagrees)
- Completeness: INCOMPLETE
- Detail: The user audit question asks: "EWC++: does TS-level adapter actually invoke the Rust EWC penalty, or is it a no-op? Check whether `MicroLoraWasm.adapt` calls into the real EWC."
  
  Tracing the surface end-to-end:
  
  1. The TS MCP tool `ruvllm_microlora_adapt` (ruvllm-tools.ts:340-357) calls `lora.adapt(quality, learningRate, success)`.
  2. That dispatches through the TS WASM wrapper `createMicroLora.adapt` (ruvllm-wasm.ts:283-290) which constructs a min-`MICROLORA_WASM_MIN_DIM=768` zero-vector input and calls `lora.adapt(input, feedback)` on the `MicroLoraWasm` class.
  3. `MicroLoraWasm` (the WASM-published `@ruvector/ruvllm-wasm` MicroLoraWasm class — distinct from the in-tree `MicroLoRA` in `lora.rs`) is a separate published WASM artefact NOT in this fork; ruvllm-wasm.ts declarations are typed in `cli/src/types/optional-modules.d.ts`.
  4. The in-tree Rust `MicroLoRA::accumulate_gradient` (lora.rs:192-210) takes a `LearningSignal` and accumulates a gradient via an outer-product approximation. `apply_accumulated` (lora.rs:213-229) applies it. **Neither path consults EWC.** EWC consultation happens in `loops/background.rs:144-174` ONLY — and the background loop is not invoked by `apply_micro_lora` (engine.rs:69-77), which is the entry point for `adapt`.
  5. Net: a per-call MCP `ruvllm_microlora_adapt` does NOT route through `EwcPlusPlus::apply_constraints` or `update_fisher`. EWC++ only protects gradients during background consolidation cycles.
  
  This may or may not be by design — `ewc.rs` docstring says "Online Fisher information estimation" and the background loop does that — but the docstring on `SonaConfig.ewcLambda` (ruvllm-wasm.ts:54) implies EWC affects every adapt. ADR-0193 and ADR-0195 do not specify the contract precisely.

### F-05-008 — `SonaTrajectoryService` (TS) is unrelated to the Rust SONA engine — naming collision

- Files: `services/SonaTrajectoryService.ts` (TS) vs `@ruvector/sona` (Rust → NAPI / WASM)
- Severity: LOW (naming hazard)
- Soundness: NON-SOUND (signature mismatch between docstrings)
- Detail: The TS `SonaTrajectoryService` claims to "Wrap @ruvector/sona for trajectory learning" (line 2-7). `initialize()` (lines 174-202) dynamically imports `@ruvector/sona` and looks for `SONA`/`Sona`/default-export classes. If found, it stores `this.sona = new SONA()`. The Rust crate's NAPI export is `SonaEngineNapi` (napi.rs); the WASM export is `WasmSonaEngine` (wasm.rs). Neither matches the names probed (`SONA` / `Sona`). Result: `initialize` returns `false` essentially always against the canonical `@ruvector/sona` build. The "available" branch in `predict`, `recordTrajectory`, `getPatterns` is mostly dead code; falls through to the in-memory + SQLite path. Not necessarily wrong (the in-memory path works) but the docstring claim that the service "uses @ruvector/sona for reinforcement learning when available" is, in practice, false on the published artefacts.

### F-05-009 — `LearningSystem.endSession` deletes from active map after `savePolicy` — TOCTOU window on dual-instance singleton

- File: `LearningSystem.ts:231-262`
- Severity: LOW
- Soundness: minor
- Detail: The singleton guard at the top of the file (lines 87-119) prevents duplicate construction, but `endSession` reads `this.activeSessions` (in-memory cache), writes the DB row, mutates `session.status='completed'`, then `activeSessions.delete(sessionId)`. If a `predict` lands between the DB UPDATE and the Map.delete, predict reads the in-memory `session` (status now 'completed') and rejects (`throw new Error('Session not active')`). Race window is small in practice (single Node loop) but the in-memory mutation should precede the DB write OR `activeSessions.delete` should fire before the throw-source mutation. Not a critical bug; flag for tightness.

### F-05-010 — SARSA copy-paste bug verified fixed at `forks/ruflo/v3/@claude-flow/neural/src/algorithms/sarsa.ts:21`

- Severity: NONE (positive finding)
- Detail: Per [[project-config-gaps]] the `cfg.neural.learningRates.qLearning` (was) → `cfg.neural.learningRates.sarsa` (now) flip is present. Inline comment `// ADR-0069: fix copy-paste bug (was .qLearning)` confirms. Default fallback 0.1 is reasonable. No regression observed.

### F-05-011 — ADR-0195 Phase 4 cross-controller event bus IS wired in agentic-flow

- Files:
  - `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:187 (private learningEvents), 1327-1329 (getLearningEvents), 1349-1351 (getLearningSystem), 1375-1433 (_attachLearningSubscriber), 1445+ (_handleAutopilotEpisode)`
  - `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:262-272 (AgentDBLike.getLearningEvents), 483-538 (emits trajectory:opened/step/closed), 983-1018 (_resolveEventBus + _emitLearningEvent), 1101-1107 (emits episode:recorded)`
- Severity: NONE (positive finding)
- Detail: ADR-0195 status is `implemented` (2026-05-19). Source trace confirms:
  - `AgentDBService.learningEvents` constructed in field initializer (line 187).
  - `getLearningEvents()` accessor and `getLearningSystem()` accessor both present.
  - `_attachLearningSubscriber` runs at `initialize()`, attaches default `'error'` listener, attaches `episode:recorded` handler that wraps `_handleAutopilotEpisode` in `setImmediate` so consumer latency doesn't backpressure producer.
  - `STEP_LEVEL_FEEDBACK_ENABLED=true` env flag opt-in for `trajectory:step` per-step submitFeedback.
  - Producer side (autopilot-learning.ts) emits all four events at the documented boundaries (`trajectory:opened`, `trajectory:step`, `trajectory:closed`, `episode:recorded`).
  - Tests exist: `tests/unit/autopilot-phase4-event-bus.test.ts`, `tests/unit/autopilot-phase4-step-feedback.test.ts`, `tests/unit/autopilot-cli-subscribe-federation.test.ts`, `tests/integration/autopilot-learning-phase4-bridges.test.ts`.
  - The broken `learningSystem.predictAction?.(state)` probe flagged in ADR-0195 §"Three additional observations grounding the design" #1 is REMOVED (verified via grep at `agentdb-service.ts:1277-1281` comment); explicit test in `tests/unit/autopilot-phase4-event-bus.test.ts:300` greps the source file to assert non-revival.

### F-05-012 — `NightlyLearner.run` emits "Reflexion + skill consolidation children are reserved for future wire-up" — incomplete

- File: `NightlyLearner.ts:168-172`
- Severity: LOW
- Completeness: INCOMPLETE (documented)
- Detail: The TODO comment says "NightlyLearner.run currently does not call `reflexion.recordEpisode` or `skillLibrary.consolidateEpisodesIntoSkills`. When those orchestration points land, mint them as `ctx.child('reflexion')` / `ctx.child('skill')`." Constructor (lines 79-109) instantiates `this.reflexion = new ReflexionMemory(db, embedder)` and `this.skillLibrary = new SkillLibrary(db, embedder)` but they are NEVER referenced in `run` or downstream private methods. Dead instantiation. The promised orchestration of Reflexion + Skill consolidation is not wired.

### F-05-013 — `NightlyLearner._childCtx` substrate-seam wraps are noted as "dead code at the live entry point"

- File: `NightlyLearner.ts:400-413, 570-577, 612-616, 684-687`
- Severity: LOW (acknowledged in code)
- Completeness: PARTIAL
- Detail: Inline comments on `discoverCausalEdges`, `completeExperiments`, `createExperiments`, `pruneEdges` explicitly state: "the cli `agentdb_learner_run` invokes `learner.run()` with no ctx, so every wrap below is dead code at the live entry point — the contract is recorded in code, activating the moment a caller mints a ctx." This is honest about its own incompleteness, but it means the audit-chain promise from ADR-0181 Item 4 is not realised in production: the bulk DELETE + per-edge / per-experiment writes bypass the archivist seam every time the nightly learner runs from MCP. Tracked in F4-2 substrate-seam wire-up.

### F-05-014 — `LearningSystem.explainAction` and `calculateReward` swallow `causal_edges` table-missing errors silently

- File: `LearningSystem.ts:1162-1173` (explainAction), `LearningSystem.ts:1332-1345` (calculateReward)
- Severity: LOW (documented intentional)
- Soundness: borderline — comment justifies as "best-effort context for explainability"
- Detail: Both methods wrap the `causal_edges` SELECT in `try { ... } catch { causalChains = []; }`. Inline comment (lines 1156-1162) explicitly says: "causal_edges is owned by CausalMemoryGraph (separate controller); the table may not exist on a fresh LearningSystem-only test instance — tolerate that with an empty-result fallback. This is not a silent failure: the controller has no authoritative schema ownership of causal_edges, and the query is best-effort context for explainability." The justification is reasonable, but it does still match the [[feedback-no-fallbacks]] pattern — error-type discrimination would be cleaner (only swallow SQLITE_ERROR no-such-table; rethrow others).

### F-05-015 — `LearningBridge` (TS) is REAL and wired — NOT a stub, per [[project-deprecated-controllers]]

- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/learning-bridge.ts` (493 lines)
- Severity: NONE (positive finding)
- Detail: Memory entry says LearningBridge MUST stay. Verified:
  - Real `learn`, `onInsightRecorded`, `onInsightAccessed`, `consolidate`, `decayConfidences`, `findSimilarPatterns`, `getStats`, `destroy` public surface.
  - Dynamically imports `@claude-flow/neural` (line 438) to load `NeuralLearningSystem`, falls back to `null` neural if optional dep missing (degrade silently). The fallback is a [[feedback-no-fallbacks]] candidate — the bridge claims `enabled: true` default but silently degrades to no-op when neural fails. Same pattern as F-05-003.
  - Subtle issue: `loadNeural` catch (line 452-456) is bare. `neuralLoader` (constructor-injected for tests) WILL surface errors — but default import path swallows them.
  - `readEwcLambdaFromConfig` (line 92-103) reads `.claude-flow/config.json` `neural.ewcLambda` with `try/catch → fallback 2000`. Sound: explicit fallback is expected for config-not-found.

### F-05-016 — `LearningBridge.consolidate` consumes failed `completeTask` calls silently

- File: `learning-bridge.ts:269-277`
- Severity: LOW
- Soundness: SILENT-FALLBACK
- Detail: Loop body around `await this.neural.completeTask(...)` uses bare `catch {}` and continues. The result counts `completed++` only on success but the failed trajectoryId is not retried, not logged, not surfaced. Per [[feedback-no-fallbacks]] this masks a real neural-system failure. The `destroy()` method has similar bare catches around neural cleanup.

### F-05-017 — `FederatedLearningManager` (deprecated-controllers memory says KEEP) — verified ALIVE

- File: `forks/agentdb/src/services/federated-learning.ts:330-436`
- Wired-at: `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:75, 107, 514, 1180, 2038-2041`
- Severity: NONE (positive finding)
- Detail: Per memory entry: "[[project-deprecated-controllers]] CORRECTED 2026-05-19: this controller is ALIVE, not a stub. Real impl at services/federated-learning.ts:330 (~106 lines)." Confirmed:
  - `FederatedLearningManager.registerAgent`, `startAggregation`, `stopAggregation`, `aggregateAll`, `getSummary`, `cleanup` all implemented.
  - Real Float32Array aggregation via `EphemeralLearningAgent` → `FederatedLearningCoordinator.aggregate` → `consolidate`.
  - No QUIC dependency; in-process across SONA ephemeral agents.
  - registry-side wiring: Level 4 controller `federatedLearningManager` constructed via `new agentdbModule.FederatedLearningManager(...)`.

### F-05-018 — `federatedSession` (deprecated controller per memory) — disabled-by-default flag present, but registry still references it

- File: `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:213` (`federatedSession: false`)
- Other refs: `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:882` (lists `federatedSessionManager` in childNames composite)
- Severity: LOW
- Completeness: REMOVABLE (per memory entry — "When removing federatedSession, update INIT_LEVELS, controller-registry type unions, config-template defaults, and acceptance tests that reference it.")
- Detail: Memory says this is the only safely-removable controller of the 4 flagged. Current state: init template emits `false`, but the controller type union, registry case, and composite child list still reference it. Future cleanup pending.

### F-05-019 — `RuVectorLearning.initialize` throws when `@ruvector/gnn` missing, swallowed by LearningSystem ctor catch (see F-05-003)

- File: `forks/agentdb/src/backends/ruvector/RuVectorLearning.ts:46-70`
- Severity: LOW (compound finding)
- Detail: `RuVectorLearning.initialize` wraps the dynamic import in try/catch and re-throws as `Error('GNN initialization failed. Please install: npm install @ruvector/gnn ...')` — this is the GOOD path (fail loud at the module surface). But the upstream caller `LearningSystem.initializeRuVectorEnhancements` (F-05-003) demotes it to `console.warn`. The contract at the module boundary is "throw with install hint"; the consumer breaks the contract.

### F-05-020 — `SonaLearningBackend.create` propagates init error (good); destroyed-state checks present

- File: `forks/agentdb/src/backends/rvf/SonaLearningBackend.ts:102-134, 354-358`
- Severity: NONE (positive finding)
- Detail: Static `create` factory throws on bad config OR `@ruvector/sona` missing — matches [[feedback-best-effort-must-rethrow-fatals]]. Every public method calls `this.ensureAlive()` first (line 354-358), throwing if destroyed. No silent fallbacks. Counter-example to the F-05-003 / F-05-004 pattern in the same fork.

### F-05-021 — `SelfLearningRvfBackend` has 14 module dependencies and is the apex learning controller — not audited deeply this slice

- File: `forks/agentdb/src/backends/rvf/SelfLearningRvfBackend.ts` (491 lines, header only inspected)
- Severity: scope-bound (acknowledged)
- Detail: This file orchestrates `SemanticQueryRouter`, `SonaLearningBackend`, `TemporalCompressor`, `IndexHealthMonitor`, `ContrastiveTrainer`, `FederatedSessionManager`, `RvfSolver`, `NativeAccelerator`. It is the "self-learning" composite for ADR-006 (Unified Memory). Did not pass-2 inspect for SILENT-FALLBACK patterns; flag for follow-up audit.

### F-05-022 — `LearningSystem.train` throws on empty experiences — sound

- File: `LearningSystem.ts:376-378`
- Severity: NONE (positive finding)
- Detail: `if (experiences.length === 0) { throw new Error('No training data available for session: ${sessionId}'); }` — fails loud, no silent fallback. Sound.

### F-05-023 — `LearningSystem.transferLearning` requires source AND target — sound

- File: `LearningSystem.ts:948-954`
- Severity: NONE (positive finding)
- Detail: Throws when neither `sourceSession` nor `sourceTask` is provided. Same for target. Sound argument-validation.

### F-05-024 — `NightlyLearner.consolidateEpisodes` fallback when no `attentionService` — silent skip

- File: `NightlyLearner.ts:256-263`
- Severity: LOW
- Soundness: SILENT-FALLBACK
- Detail: When `this.attentionService` is null (FlashAttention disabled — the default per `ENABLE_FLASH_CONSOLIDATION: false`), the method `await this.discoverCausalEdges()` and returns `{ edgesDiscovered, episodesProcessed: 0 }`. The `episodesProcessed: 0` is a lie — `discoverCausalEdges` processed up to 1000 candidate pairs from `episodes`. Per the docstring (line 228), this method is supposed to process episodes through FlashAttention specifically; the fallback path is documented as "Standard discovery without attention" but the return shape conflates two semantically different operations.

### F-05-025 — `SonaTrajectoryService` SQLite + in-memory dual-write per ADR-0181 Item 6 — sound

- File: `services/SonaTrajectoryService.ts:251-263, 329-358, 388-418`
- Severity: NONE (positive finding)
- Detail: Item 6 explicitly establishes that SQLite is the corpus durability layer and the Map preserves same-process freshness. The lazy `getDb` resolver pattern (line 128-135) is documented as defending against [[feedback-singleton-frozen-state-desync]]. SQL errors re-throw per [[feedback-best-effort-must-rethrow-fatals]] (line 253-255 inline comment). Good counter-example to the F-05-003 / F-05-004 pattern.

### F-05-026 — `LearningSystem` `_singleton` pattern — works but tight coupling between `ControllerRegistry` and `AgentDBService` ownership

- File: `LearningSystem.ts:87-119`
- Severity: LOW
- Detail: ADR-0076 A4 guard pattern: if `_singleton` is non-null, ctor returns the existing instance instead of constructing. Without `_resetSingleton()` (line 104), test isolation requires explicit reset between tests. Documented but a footgun for new contributors. Same pattern exists on NightlyLearner? — not present (NightlyLearner is constructed per-call).

## Cross-cutting observations

### O-1: Silent-fallback pattern is widespread but not uniform

`LearningSystem.initializeRuVectorEnhancements` (F-05-003), `SonaTrajectoryService.predict` (F-05-004), `SonaTrajectoryService.recordTrajectory` (F-05-005), `LearningBridge.consolidate` (F-05-016), `LearningBridge.loadNeural` (F-05-015), `NightlyLearner.consolidateEpisodes` fallback (F-05-024) all bare-`catch` and downgrade to a no-op. Counter-examples that re-throw (sound): `SonaLearningBackend.create` (F-05-020), `RuVectorLearning.initialize` (F-05-019 — but consumer breaks the contract), `LearningSystem.train` empty-experiences guard (F-05-022), `SonaTrajectoryService.recordTrajectory` SQLite path (F-05-025).

### O-2: EWC++ is real but its reach is narrower than docstrings suggest

EWC++ is fully implemented in Rust (F-05-006) and active in the SONA background loop. It is NOT in the per-call `MicroLoraWasm.adapt` path (F-05-007). The TS-side advertised "EWC protection against catastrophic forgetting" (e.g., `LearningBridge` config option `ewcLambda`, `SonaConfig.ewcLambda` plumbed through `SonaLearningBackend.create`) only takes effect inside the periodic background cycle. ADR-0193/0195 do not pin this contract precisely. Per-call adapts use only the LoRA gradient accumulator.

### O-3: Documented "future-wire" stubs vs broken stubs

`NightlyLearner.discover` (F-05-001) returns empty array unconditionally with an "in a real implementation, we'd track..." comment. That's a broken stub presenting itself as complete. Contrast with `NightlyLearner.run` reflexion/skill children (F-05-012) which are absent-but-explicitly-documented-as-future-work in the inline comment. Both signal incompleteness; only the latter is honest at the API boundary.

### O-4: Autopilot Phase 4 (ADR-0195) is fully wired

The cross-controller event bus is the most architecturally significant piece in this slice. AgentDBService owns the long-lived bus; AutopilotLearning emits at four boundaries; LearningSystem subscribes via `_attachLearningSubscriber` at init time with synthesised per-subject sessionIds. The dead `predictAction` probe is removed and a grep test in `autopilot-phase4-event-bus.test.ts` guards against revival. Implementation matches the ADR's "Chosen: Option 1" exactly.

### O-5: SARSA, FederatedLearningManager, LearningBridge — three "keep" items verified ALIVE

Per [[project-config-gaps]] / [[project-deprecated-controllers]] memory:
- SARSA copy-paste bug stayed fixed (F-05-010).
- LearningBridge is real and load-bearing — DO NOT remove (F-05-015).
- FederatedLearningManager is alive Float32Array aggregation, NOT a QUIC story — DO NOT remove (F-05-017).
- federatedSession is removable; partially gated (F-05-018).

## Severity counts

- HIGH: 2 (F-05-001 stub returning empty array; F-05-007 EWC not in per-call adapt — feature gap)
- MEDIUM: 3 (F-05-002 synthetic actions, F-05-003 swallowed inits, F-05-004 swallowed native errors)
- LOW: 11 (F-05-005/009/012/013/014/016/018/019/021/024/026)
- NONE (positive findings): 8 (F-05-006/010/011/015/017/020/022/023/025)

## Output file path

/Users/henrik/source/ruflo-patch/docs/audits/2026-05-19-soundness-audit/05-controllers-learning.md
