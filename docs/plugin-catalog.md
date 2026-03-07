# Claude Flow Plugin Catalog

All plugins installable via the Claude Flow CLI plugin manager.

**Install command (repackaged):**
```bash
npx @sparkleideas/cli plugins install --name <plugin-name>
```

**Install command (upstream):**
```bash
npx @claude-flow/cli plugins install --name <plugin-name>
```

**List installed plugins:**
```bash
npx @sparkleideas/cli plugins list
```

---

## Table of Contents

| # | Plugin | Category | MCP Tools |
|---|--------|----------|-----------|
| 1 | [Agentic QE](#1-agentic-qe) | Quality Engineering | 58 agents |
| 2 | [Code Intelligence](#2-code-intelligence) | Code Analysis | 5 tools |
| 3 | [Cognitive Kernel](#3-cognitive-kernel) | Cognitive Augmentation | 5 tools |
| 4 | [Financial Risk](#4-financial-risk) | Financial Analysis | 5 tools |
| 5 | [Gastown Bridge](#5-gastown-bridge) | Workflow Orchestration | 20 tools |
| 6 | [Healthcare Clinical](#6-healthcare-clinical) | Clinical Decision Support | 5 tools |
| 7 | [Hyperbolic Reasoning](#7-hyperbolic-reasoning) | Hierarchical Reasoning | 4 tools |
| 8 | [Legal Contracts](#8-legal-contracts) | Legal Analysis | 5 tools |
| 9 | [Neural Coordination](#9-neural-coordination) | Multi-Agent Coordination | 5 tools |
| 10 | [Performance Optimizer](#10-performance-optimizer) | Performance Analysis | 5 tools |
| 11 | [Prime Radiant](#11-prime-radiant) | Mathematical Verification | 5 tools |
| 12 | [Quantum Optimizer](#12-quantum-optimizer) | Optimization | 4 tools |
| 13 | [Teammate Plugin](#13-teammate-plugin) | Claude Code Integration | 16 tools |
| 14 | [Test Intelligence](#14-test-intelligence) | Test Optimization | 5 tools |

---

## 1. Agentic QE

**Package:** `@claude-flow/plugin-agentic-qe`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-agentic-qe
```

AI-powered quality engineering that writes tests, finds bugs, and breaks things (safely) so your users don't have to. This plugin adds 58 AI agents to Claude Flow that handle all aspects of software quality. It writes unit tests, integration tests, E2E tests, and chaos tests automatically. It finds coverage gaps, showing exactly which code paths aren't tested. It includes ML-based defect prediction from code patterns, security scanning to find vulnerabilities, secrets, and compliance issues, and chaos engineering to test system resilience safely.

The plugin supports a full TDD workflow — give it a requirement and it runs the complete red-green-refactor cycle. It can operate in London-school (mock-first) or Chicago-school (integration-first) style. Point it at a file and get comprehensive tests generated for any framework (vitest, jest, mocha, pytest).

**Key capabilities:**
- Automatic test generation (unit, integration, E2E, chaos)
- Coverage gap analysis with code path visualization
- ML-based defect prediction from code patterns
- Security vulnerability scanning and compliance checking
- Full TDD red-green-refactor automation
- Chaos engineering for resilience testing

---

## 2. Code Intelligence

**Package:** `@claude-flow/plugin-code-intelligence`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-code-intelligence
```

A comprehensive code intelligence plugin combining graph neural networks for code structure analysis with ultra-fast vector search for semantic code similarity. It enables dead code detection, API surface analysis, refactoring impact prediction, and architectural drift monitoring while integrating seamlessly with existing IDE workflows.

The semantic code search finds similar code across the entire codebase using natural language or code snippets. Architecture analysis detects dependency graphs, layer violations, circular dependencies, and architectural drift. The refactoring impact prediction uses GNN analysis to predict the blast radius of proposed changes before you make them. Module splitting suggestions use MinCut algorithms to find optimal module boundaries.

**MCP Tools:**
- `code/semantic-search` — Find semantically similar code using natural language queries
- `code/architecture-analyze` — Analyze dependency graphs, detect circular deps, dead code, layer violations (outputs Mermaid diagrams)
- `code/refactor-impact` — Predict impact of refactoring changes using GNN dependency analysis
- `code/module-split` — Suggest optimal module boundaries using MinCut algorithms
- `code/pattern-learn` — Learn recurring patterns from code changes using SONA (Self-Optimizing Neural Architecture)

**WASM acceleration:** micro-hnsw-wasm, ruvector-gnn-wasm, ruvector-mincut-wasm, sona

---

## 3. Cognitive Kernel

**Package:** `@claude-flow/plugin-cognitive-kernel`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-cognitive-kernel
```

A cutting-edge cognitive augmentation plugin combining the Cognitum Gate Kernel with SONA self-optimizing architecture to provide LLMs with enhanced cognitive capabilities. It enables dynamic working memory, attention control mechanisms, meta-cognitive self-monitoring, and cognitive scaffolding while maintaining low latency through WASM acceleration.

Working memory management uses Miller's number (7 slots) with configurable capacity, priority-based allocation, and decay modeling. Attention control provides focus/diffuse/scan modes with entity-specific weighting, novelty bias, and temporal duration controls. Meta-cognitive monitoring tracks reasoning quality, detects cognitive biases, and triggers self-correction. The cognitive scaffolding system provides structured reasoning frameworks (analogical, causal, counterfactual, abductive) for complex problem decomposition.

**MCP Tools:**
- `cognition/working-memory` — Manage dynamic working memory slots with priority and decay
- `cognition/attention-control` — Control attention focus with entity weighting and novelty bias
- `cognition/meta-monitor` — Monitor reasoning quality and detect cognitive biases
- `cognition/scaffold` — Apply structured reasoning frameworks (analogical, causal, counterfactual)
- `cognition/cognitive-load` — Estimate and manage cognitive load for task complexity

**WASM acceleration:** cognitum-gate-kernel, sona, ruvector-attention-wasm

---

## 4. Financial Risk

**Package:** `@claude-flow/plugin-financial-risk`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-financial-risk
```

A high-performance financial risk analysis plugin combining sparse inference for efficient market signal processing with graph neural networks for transaction network analysis. It enables real-time anomaly detection, portfolio risk scoring, and automated compliance reporting while maintaining the explainability required by financial regulators (SEC, FINRA, Basel III).

Portfolio risk analysis calculates VaR, CVaR, Sharpe ratio, Sortino ratio, and max drawdown across multi-asset portfolios. Anomaly detection identifies fraud, AML violations, and market manipulation in transaction networks using GNN-based pattern recognition. Market regime classification identifies the current market regime through historical pattern matching. Regulatory compliance checking provides automated verification against Basel III, MiFID II, Dodd-Frank, AML, and KYC frameworks. Stress testing runs historical and hypothetical stress scenarios on portfolios.

**MCP Tools:**
- `finance/portfolio-risk` — Calculate VaR, CVaR, Sharpe, Sortino, max drawdown
- `finance/anomaly-detect` — Detect fraud, AML violations, market manipulation in transactions
- `finance/market-regime` — Classify current market regime through historical pattern matching
- `finance/compliance-check` — Verify compliance with Basel III, MiFID II, Dodd-Frank, AML, KYC
- `finance/stress-test` — Run historical and hypothetical stress scenarios

**WASM acceleration:** micro-hnsw-wasm, ruvector-economy-wasm, ruvector-sparse-inference-wasm

---

## 5. Gastown Bridge

**Package:** `@claude-flow/plugin-gastown-bridge`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-gastown-bridge
```

WASM-accelerated bridge to Steve Yegge's Gas Town multi-agent orchestrator. Gas Town is a 75,000-line Go codebase that implements battle-tested concepts for durable workflow execution: Beads (git-backed issue tracking with graph semantics), Formulas (TOML-defined workflows), Convoys (work-order tracking for "slung" work between agents), GUPP (crash-resilient execution), and Molecules/Wisps (chained work units for resumable workflows).

This plugin bridges Gas Town's Go-based system into Claude Flow's JavaScript ecosystem using a hybrid architecture: CLI bridge for I/O operations and Rust-compiled WASM for compute-intensive tasks. The WASM acceleration delivers dramatic speedups: formula parsing is 352x faster, variable cooking is 350x faster, DAG topological sort is 150x faster, and HNSW pattern search is 1,000x-12,500x faster than pure JavaScript.

The plugin also provides bidirectional sync between Gas Town's Beads and Claude Flow's AgentDB, enabling seamless interoperability between the two orchestration systems.

**MCP Tools (20):**
- Beads (5): `gastown/bead-create`, `gastown/bead-ready`, `gastown/bead-show`, `gastown/bead-dep`, `gastown/bead-sync`
- Convoy (3): `gastown/convoy-create`, `gastown/convoy-status`, `gastown/convoy-track`
- Formula (4): `gastown/formula-list`, `gastown/formula-cook`, `gastown/formula-execute`, `gastown/formula-create`
- Orchestration (3): `gastown/sling`, `gastown/agents`, `gastown/mail`
- WASM (5): `gastown/wasm-parse`, `gastown/wasm-resolve`, `gastown/wasm-cook-batch`, `gastown/wasm-match`, `gastown/wasm-optimize`

**WASM speedups:** Formula parse 352x, variable cooking 350x, DAG sort 150x, HNSW search 1,000x-12,500x

**Note:** This plugin is an `optionalDependency` of `@claude-flow/cli` and is a candidate for integration into the `@sparkleideas` scope (see [ADR-0022](adr/0022-full-ecosystem-repackaging.md) and [package matrix](ruvnet.packages.and.source.location.md)).

---

## 6. Healthcare Clinical

**Package:** `@claude-flow/plugin-healthcare-clinical`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-healthcare-clinical
```

A HIPAA-compliant clinical decision support plugin that combines ultra-fast vector search for medical literature retrieval with graph neural networks for patient pathway analysis. It enables semantic search across medical records, drug interaction detection, and evidence-based treatment recommendations while maintaining strict data privacy through on-device WASM processing — no patient data leaves the local machine.

Patient similarity search finds comparable clinical cases based on diagnoses (ICD-10), lab results, vitals, and medication profiles. Drug interaction detection analyzes drug-drug and drug-condition interactions using graph neural network analysis of pharmacological relationship graphs. Clinical pathway recommendations suggest evidence-based treatment pathways based on diagnosis and patient history. Medical literature search provides semantic retrieval across PubMed, Cochrane, and UpToDate databases with evidence level filtering. Ontology navigation traverses ICD-10, SNOMED-CT, LOINC, and RxNorm hierarchies using hyperbolic embeddings for efficient hierarchical representation.

**MCP Tools:**
- `healthcare/patient-similarity` — Find similar patient cases by clinical features
- `healthcare/drug-interactions` — Detect drug-drug and drug-condition interactions
- `healthcare/clinical-pathway` — Recommend evidence-based clinical pathways
- `healthcare/literature-search` — Semantic search across medical literature databases
- `healthcare/ontology-navigate` — Navigate ICD-10, SNOMED-CT, LOINC, RxNorm hierarchies

**WASM acceleration:** micro-hnsw-wasm, ruvector-gnn-wasm, ruvector-hyperbolic-hnsw-wasm

---

## 7. Hyperbolic Reasoning

**Package:** `@claude-flow/plugin-hyperbolic-reasoning`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-hyperbolic-reasoning
```

An exotic reasoning plugin implementing hyperbolic neural networks for superior hierarchical understanding. Hyperbolic space (specifically the Poincare ball model) naturally represents tree-like and hierarchical structures with exponentially more capacity than Euclidean space — a property that makes it ideal for modeling taxonomies, organizational hierarchies, file system structures, and code dependency trees.

The plugin enables efficient representation of tree structures through Poincare ball embeddings with Mobius operations. It supports taxonomic reasoning (is-a relationships, subsumption checking), hierarchical entailment detection, and nearest common ancestor computation. Applications include improved ontology navigation, hierarchical code understanding (package > module > class > method), and organizational relationship modeling. Curvature can be learned automatically from data, adapting the geometry to match the inherent hierarchy depth.

**MCP Tools:**
- `hyperbolic/embed-hierarchy` — Embed hierarchical data in Poincare ball space
- `hyperbolic/taxonomic-reason` — Perform taxonomic reasoning (subsumption, is-a)
- `hyperbolic/hierarchy-navigate` — Navigate and query hierarchical embeddings
- `hyperbolic/curvature-learn` — Learn optimal curvature from hierarchical data

**WASM acceleration:** ruvector-hyperbolic-hnsw-wasm, ruvector-attention-wasm

---

## 8. Legal Contracts

**Package:** `@claude-flow/plugin-legal-contracts`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-legal-contracts
```

A comprehensive legal contract analysis plugin combining hyperbolic embeddings for legal ontology navigation with fast vector search for clause similarity. It enables automated clause extraction, risk scoring, obligation tracking, and regulatory compliance checking while maintaining attorney-client privilege through on-device processing — no contract text is sent to external services.

Clause extraction identifies and classifies contract clauses by type (indemnification, limitation of liability, termination, force majeure, confidentiality, IP assignment) with positional information for document navigation. Risk assessment scores contractual risks by category (financial, legal, operational, reputational) with severity levels and mitigation recommendations from the perspective of either buyer or seller. Contract comparison provides detailed semantic diffs between contracts with redline generation, showing how a vendor's proposed terms deviate from your standard. Obligation tracking extracts deadlines, deliverables, and dependencies as a DAG, enabling timeline visualization and deadline management. Playbook matching compares contract clauses against pre-defined negotiation playbook positions (preferred, acceptable, walkaway).

**MCP Tools:**
- `legal/clause-extract` — Extract and classify clauses from legal documents
- `legal/risk-assess` — Score contractual risks by category and severity
- `legal/contract-compare` — Compare contracts with semantic diff and redline
- `legal/obligation-track` — Extract obligations, deadlines, and dependencies as DAG
- `legal/playbook-match` — Compare clauses against negotiation playbook positions

**WASM acceleration:** micro-hnsw-wasm, ruvector-attention-wasm, ruvector-dag-wasm

---

## 9. Neural Coordination

**Package:** `@claude-flow/plugin-neural-coordination`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-neural-coordination
```

A cutting-edge multi-agent coordination plugin combining the SONA self-optimizing neural architecture with graph neural networks for agent communication topology optimization. It enables emergent protocol development, neural consensus mechanisms, collective memory formation, and adaptive swarm behavior while maintaining interpretability of agent interactions.

Neural consensus allows agents with different preference weights to negotiate decisions through iterative refinement or neural voting protocols, producing decisions with voting breakdowns, confidence scores, and round-by-round negotiation history. Communication topology optimization uses GNN analysis to find the most efficient agent communication graph for a given task. Emergent protocol development allows agents to evolve their own communication protocols through interaction. Collective memory formation builds shared knowledge representations across agent swarms. Adaptive swarm behavior adjusts agent roles and connections based on task requirements and performance feedback.

**MCP Tools:**
- `coordination/neural-consensus` — Achieve agent consensus using neural negotiation protocols
- `coordination/topology-optimize` — Optimize agent communication topology using GNN
- `coordination/emergent-protocol` — Develop emergent communication protocols
- `coordination/collective-memory` — Form and query collective agent memory
- `coordination/adaptive-swarm` — Adapt swarm behavior based on task feedback

**WASM acceleration:** sona, ruvector-nervous-system-wasm, ruvector-attention-wasm

---

## 10. Performance Optimizer

**Package:** `@claude-flow/plugin-performance-optimizer`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-performance-optimizer
```

A comprehensive performance optimization plugin combining sparse inference for efficient trace analysis with graph neural networks for dependency chain optimization. It enables intelligent bottleneck detection, memory leak identification, N+1 query detection, and bundle size optimization while providing explainable recommendations based on historical performance patterns.

Bottleneck detection uses GNN-based dependency analysis on trace data (OpenTelemetry, Chrome DevTools, or custom format) to identify the root causes of latency, not just the symptoms. Memory analysis detects retention chains, GC pressure points, and slow-growing leaks that escape traditional profiling. Query optimization identifies N+1 patterns, missing indexes, and slow joins in database access patterns. Bundle optimization analyzes JavaScript bundles for tree shaking opportunities, code splitting candidates, and duplicate dependency elimination. Configuration optimization uses SONA to learn optimal configurations (thread pools, cache sizes, connection limits) from workload patterns.

**MCP Tools:**
- `perf/bottleneck-detect` — Detect performance bottlenecks using GNN dependency analysis
- `perf/memory-analyze` — Detect memory leaks, retention chains, and GC pressure
- `perf/query-optimize` — Detect N+1 queries, missing indexes, slow joins
- `perf/bundle-optimize` — Analyze and optimize JavaScript bundle size
- `perf/config-optimize` — Learn optimal configurations from workload patterns

**WASM acceleration:** ruvector-sparse-inference-wasm, ruvector-fpga-transformer-wasm

---

## 11. Prime Radiant

**Package:** `@claude-flow/plugin-prime-radiant`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-prime-radiant
```

Mathematical AI that catches contradictions, verifies consensus, and prevents hallucinations before they cause problems. This plugin brings advanced mathematical techniques to Claude Flow for ensuring AI reliability: coherence checking detects when information contradicts itself before storing it, consensus verification mathematically verifies that multiple agents actually agree (not just appear to), and hallucination prevention catches inconsistent RAG results before they reach users.

The coherence checker uses energy-based models where low energy (0.0-0.1) indicates fully consistent information safe to store, while high energy (0.7-1.0) indicates major contradictions that should be rejected. Consensus verification goes beyond simple voting — it checks semantic coherence of agent states to determine whether agreement is genuine or superficial. Stability analysis uses spectral graph theory to monitor swarm health, detecting fragmentation or instability before it causes failures. Causal inference distinguishes cause-and-effect from mere correlations, enabling more reliable automated reasoning.

**MCP Tools:**
- `pr_coherence_check` — Detect contradictions in information before storage
- `pr_consensus_verify` — Mathematically verify multi-agent consensus
- `pr_stability_analyze` — Monitor swarm stability using spectral graph theory
- `pr_causal_infer` — Distinguish causation from correlation
- `pr_hallucination_detect` — Catch inconsistent RAG results

**Energy levels:** 0.0-0.1 (consistent), 0.1-0.3 (warning), 0.3-0.7 (contradictions), 0.7-1.0 (reject)

---

## 12. Quantum Optimizer

**Package:** `@claude-flow/plugin-quantum-optimizer`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-quantum-optimizer
```

An exotic optimization plugin implementing quantum-inspired algorithms including Quantum Annealing simulation, QAOA (Quantum Approximate Optimization Algorithm) emulation, and Grover-inspired search acceleration. The plugin provides dramatic speedups for dependency resolution, optimal scheduling, and constraint satisfaction while running entirely on classical WASM-accelerated hardware — no quantum computer required.

Quantum annealing solves combinatorial optimization problems (QUBO, Ising models, SAT, Max-Cut, TSP, dependency resolution) through simulated thermal annealing with configurable temperature schedules. QAOA emulates the quantum approximate optimization algorithm for graph-based optimization problems. Schedule optimization finds optimal task schedules considering dependencies, resource constraints, deadlines, and cost minimization using quantum-inspired search. Grover-inspired search provides quadratic-class speedup for unstructured search problems through amplitude amplification simulation.

**MCP Tools:**
- `quantum/annealing-solve` — Solve combinatorial optimization via simulated quantum annealing
- `quantum/qaoa-optimize` — QAOA emulation for graph optimization problems
- `quantum/schedule-optimize` — Find optimal task schedules with resource constraints
- `quantum/grover-search` — Grover-inspired accelerated search

**Problem types:** QUBO, Ising, SAT, Max-Cut, TSP, dependency resolution

**WASM acceleration:** ruvector-exotic-wasm, ruvector-hyperbolic-hnsw-wasm

---

## 13. Teammate Plugin

**Package:** `@claude-flow/teammate-plugin`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/teammate-plugin
```

**Requires:** Claude Code >= 2.1.19

Native TeammateTool integration plugin for Claude Flow. Bridges Claude Code v2.1.19+ multi-agent orchestration capabilities with Claude Flow's swarm system. This is the only supported way to use Claude Code's native TeammateTool feature with Claude Flow swarms.

The plugin enables team management (create, discover, load teams with topology options), teammate spawning (bridging AgentInput schema to Claude Flow's Task tool), direct and broadcast messaging with priority and type metadata, plan approval workflows (submit, approve, reject, launch), permission delegation between teammates, session memory persistence across sessions, team teleportation across terminal instances via tmux, and experimental remote sync to Claude.ai.

When TeammateTool is unavailable (Claude Code < 2.1.19), the plugin degrades gracefully to MCP-based fallback mode, providing the same API surface with reduced native integration.

**MCP Tools (16):**
- Team: `teammate/spawn_team`, `teammate/discover`, `teammate/load_team`
- Agents: `teammate/spawn`, `teammate/message`, `teammate/broadcast`
- Planning: `teammate/plan`, `teammate/approve`, `teammate/reject`, `teammate/launch`
- Delegation: `teammate/delegate`, `teammate/revoke`
- Session: `teammate/save_session`, `teammate/restore_session`
- Advanced: `teammate/teleport`, `teammate/remote_sync`

**Note:** Not yet repackaged under `@sparkleideas` scope. See [ADR-0022](adr/0022-full-ecosystem-repackaging.md) for integration status (deferred — requires TypeScript build step).

---

## 14. Test Intelligence

**Package:** `@claude-flow/plugin-test-intelligence`

**Install:**
```bash
npx @sparkleideas/cli plugins install --name @claude-flow/plugin-test-intelligence
```

A comprehensive test intelligence plugin combining reinforcement learning for optimal test selection with graph neural networks for code-to-test mapping. It enables predictive test selection (run only tests likely to fail), flaky test detection, mutation testing optimization, and test coverage gap identification while integrating seamlessly with popular testing frameworks (vitest, jest, mocha, pytest).

Predictive test selection uses reinforcement learning trained on test history to identify which tests are most likely to fail given a set of code changes, enabling dramatically faster CI feedback loops. Flaky test detection analyzes test execution history to identify intermittent failures, classify root causes (timing, ordering, resource contention, non-determinism), and suggest fixes. Coverage gap analysis goes beyond line coverage — it uses GNN-based code-to-test graph analysis to find semantically important code paths that lack test coverage, prioritized by risk. Mutation testing optimization applies mutations to code and runs only the tests predicted to catch each mutation, reducing mutation testing time by orders of magnitude.

**MCP Tools:**
- `test/select-predictive` — Select tests most likely to fail based on code changes
- `test/flaky-detect` — Identify and analyze flaky tests with root cause classification
- `test/coverage-gaps` — Find semantically important untested code paths
- `test/mutation-optimize` — Optimize mutation testing for efficiency
- `test/generate-suggestions` — Suggest test cases for uncovered code paths

**WASM acceleration:** ruvector-learning-wasm, ruvector-gnn-wasm, sona

---

## WASM Package Dependencies

All compute-intensive operations are accelerated through Rust-compiled WASM packages from the [RuVector](https://github.com/ruvnet/ruvector) project:

| WASM Package | Used By | Purpose |
|-------------|---------|---------|
| `micro-hnsw-wasm` | Code Intel, Financial, Healthcare, Legal, Gastown | Ultra-fast HNSW vector similarity search |
| `ruvector-attention-wasm` | Cognitive, Hyperbolic, Legal, Neural Coord | Flash attention mechanism (2.49x-7.47x speedup) |
| `ruvector-gnn-wasm` | Code Intel, Healthcare, Neural Coord, Test Intel | Graph Neural Networks |
| `ruvector-hyperbolic-hnsw-wasm` | Healthcare, Hyperbolic, Quantum | Poincare ball embeddings |
| `ruvector-learning-wasm` | Test Intelligence | Reinforcement learning algorithms |
| `ruvector-nervous-system-wasm` | Neural Coordination | Neural coordination for multi-agent systems |
| `ruvector-economy-wasm` | Financial Risk | Token economics and resource allocation |
| `ruvector-exotic-wasm` | Quantum Optimizer | Quantum-inspired optimization |
| `ruvector-sparse-inference-wasm` | Financial, Performance | Sparse matrix inference |
| `ruvector-fpga-transformer-wasm` | Performance Optimizer | FPGA-accelerated transformers |
| `ruvector-mincut-wasm` | Code Intelligence | Graph partitioning algorithms |
| `ruvector-dag-wasm` | Legal Contracts | DAG processing |
| `cognitum-gate-kernel` | Cognitive Kernel | Cognitive computation kernels |
| `sona` | Code Intel, Cognitive, Neural Coord, Test Intel | Self-Optimizing Neural Architecture |

---

## References

- Plugin source: [github.com/ruvnet/ruflo/v3/plugins/](https://github.com/ruvnet/ruflo/tree/main/v3/plugins)
- WASM packages: [github.com/ruvnet/ruvector](https://github.com/ruvnet/ruvector)
- Repackaging status: [Package Matrix](ruvnet.packages.and.source.location.md)
- Teammate integration ADR: [ADR-0022](adr/0022-full-ecosystem-repackaging.md)
