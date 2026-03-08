#!/usr/bin/env bash
# scripts/build.sh — Standalone build (phases 1-8 only, ADR-0026)
#
# Builds artifacts without running tests or publishing.
# Caches at /tmp/ruflo-build. Skips if fresh (use --force to override).
#
# Usage: bash scripts/build.sh [--pull] [--force]
#
# See: ADR-0026 (pipeline stage decoupling)
exec bash "$(dirname "$0")/sync-and-build.sh" --build-only "$@"
