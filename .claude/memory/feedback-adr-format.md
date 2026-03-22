---
name: ADR format requirement
description: All ADRs must use SPARC methodology (Specification, Pseudocode, Architecture, Refinement, Completion) and MADR template format
type: feedback
---

All ADRs MUST use SPARC + MADR format.

**Why:** User explicitly requires this as the standard for all architecture decision records in this project. Ensures consistency and thorough analysis across all ADRs.

**How to apply:** When creating any new ADR (docs/adr/NNNN-*.md):
1. Use MADR template: Status, Date, Deciders, Context, Decision, Consequences, Related
2. Use SPARC sections within the Decision: Specification (SPARC-S), Pseudocode (SPARC-P), Architecture (SPARC-A), Refinement (SPARC-R), Completion (SPARC-C)
3. Set `## Methodology` to `SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) + MADR`
4. Every ADR gets all 5 SPARC phases — never skip phases
