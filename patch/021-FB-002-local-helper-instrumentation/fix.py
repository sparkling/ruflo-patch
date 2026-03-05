# FB-002: Instrument local helper fallback code paths with debug logging
# Note: This file is concatenated with lib/common.py by patch-all.sh.
# All common.py variables (patch, SRC_*, etc.) are already in scope.

PROJECT_ROOT = os.environ.get("PROJECT_ROOT", "/home/claude/src/ruflo")
LOCAL_INTEL = os.path.join(PROJECT_ROOT, ".claude", "helpers", "intelligence.cjs")
LOCAL_AUTO_MEM = os.path.join(PROJECT_ROOT, ".claude", "helpers", "auto-memory-hook.mjs")
LOCAL_LEARNING = os.path.join(PROJECT_ROOT, ".claude", "helpers", "learning-service.mjs")
LOCAL_HOOK = os.path.join(PROJECT_ROOT, ".claude", "helpers", "hook-handler.cjs")

# ── intelligence.cjs ─────────────────────────────────────────────────────────

# FB-002-01: readJSON fallback (line 51)
for target in [SRC_INTELLIGENCE_CJS, LOCAL_INTEL]:
    patch("FB-002-01: intelligence.cjs readJSON silent catch",
        target,
        """  } catch { /* corrupt file — start fresh */ }
  return null;""",
        """  } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-01: readJSON failed for ' + filePath, JSON.stringify({error: String(e)})); }
  return null;""")

# FB-002-02: sessionGet fallback (line 90)
for target in [SRC_INTELLIGENCE_CJS, LOCAL_INTEL]:
    patch("FB-002-02: intelligence.cjs sessionGet silent catch",
        target,
        """  } catch { return null; }
}

function sessionSet""",
        """  } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-02: sessionGet failed for key=' + key, JSON.stringify({error: String(e)})); return null; }
}

function sessionSet""")

# FB-002-03: sessionSet fallback (line 104)
for target in [SRC_INTELLIGENCE_CJS, LOCAL_INTEL]:
    patch("FB-002-03: intelligence.cjs sessionSet silent catch",
        target,
        """  } catch { /* best effort */ }
}

// ── PageRank""",
        """  } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-03: sessionSet failed for key=' + key, JSON.stringify({error: String(e)})); }
}

// ── PageRank""")

# FB-002-04: bootstrapFromMemoryFiles project dir scan (line 249)
for target in [SRC_INTELLIGENCE_CJS, LOCAL_INTEL]:
    patch("FB-002-04: intelligence.cjs bootstrap projectDirs catch",
        target,
        """      } catch { /* skip */ }
    } else if (fs.existsSync(base)) {""",
        """      } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-04: bootstrap projectDirs scan failed', JSON.stringify({base, error: String(e)})); }
    } else if (fs.existsSync(base)) {""")

# FB-002-05: parseMemoryDir catch (line 287)
for target in [SRC_INTELLIGENCE_CJS, LOCAL_INTEL]:
    patch("FB-002-05: intelligence.cjs parseMemoryDir silent catch",
        target,
        """  } catch { /* skip unreadable dirs */ }
}""",
        """  } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-05: parseMemoryDir failed', JSON.stringify({dir, error: String(e)})); }
}""")

# FB-002-06: consolidate JSON.parse skip malformed (line 534)
for target in [SRC_INTELLIGENCE_CJS, LOCAL_INTEL]:
    patch("FB-002-06: intelligence.cjs consolidate malformed insight",
        target,
        """      } catch { /* skip malformed */ }""",
        """      } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-06: malformed insight line', JSON.stringify({line, error: String(e)})); }""")

# ── auto-memory-hook.mjs ─────────────────────────────────────────────────────

# FB-002-07: JsonFileBackend initialize parse failure (line 54)
for target in [SRC_AUTO_MEMORY_HOOK, LOCAL_AUTO_MEM]:
    patch("FB-002-07: auto-memory-hook.mjs JsonFileBackend init parse fail",
        target,
        """      } catch { /* start fresh */ }""",
        """      } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-07: JsonFileBackend parse failed', JSON.stringify({file: this.filePath, error: String(e)})); }""")

# FB-002-08: JsonFileBackend _persist failure (line 125)
for target in [SRC_AUTO_MEMORY_HOOK, LOCAL_AUTO_MEM]:
    patch("FB-002-08: auto-memory-hook.mjs _persist failure",
        target,
        """    } catch { /* best effort */ }
  }
}

// =====""",
        """    } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-08: _persist failed', JSON.stringify({file: this.filePath, error: String(e)})); }
  }
}

// =====""")

# FB-002-09: loadMemoryPackage local dist fail (line 139)
for target in [SRC_AUTO_MEMORY_HOOK, LOCAL_AUTO_MEM]:
    patch("FB-002-09: auto-memory-hook.mjs loadMemoryPackage local dist fail",
        target,
        """    } catch { /* fall through */ }
  }

  // Strategy 2: npm installed""",
        """    } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-09: loadMemoryPackage local dist import failed', JSON.stringify({path: localDist, error: String(e)})); }
  }

  // Strategy 2: npm installed""")

# FB-002-10: loadMemoryPackage npm fail (line 145)
for target in [SRC_AUTO_MEMORY_HOOK, LOCAL_AUTO_MEM]:
    patch("FB-002-10: auto-memory-hook.mjs loadMemoryPackage npm fail",
        target,
        """  } catch { /* fall through */ }

  // Strategy 3: Installed via""",
        """  } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-10: loadMemoryPackage npm import failed', JSON.stringify({error: String(e)})); }

  // Strategy 3: Installed via""")

# FB-002-11: loadMemoryPackage cli memory fail (line 152)
for target in [SRC_AUTO_MEMORY_HOOK, LOCAL_AUTO_MEM]:
    patch("FB-002-11: auto-memory-hook.mjs loadMemoryPackage cli memory fail",
        target,
        """    } catch { /* fall through */ }
  }

  return null;
}""",
        """    } catch (e) { console.warn('[RUFLO-FALLBACK] FB-002-11: loadMemoryPackage cli memory import failed', JSON.stringify({path: cliMemory, error: String(e)})); }
  }

  return null;
}""")

# FB-002-12: readConfig YAML parse failure (line 190)
for target in [SRC_AUTO_MEMORY_HOOK, LOCAL_AUTO_MEM]:
    patch("FB-002-12: auto-memory-hook.mjs readConfig YAML parse failure",
        target,
        """  } catch {
    return defaults;
  }
}

// =====""",
        """  } catch (e) {
    console.warn('[RUFLO-FALLBACK] FB-002-12: readConfig YAML parse failed', JSON.stringify({error: String(e)}));
    return defaults;
  }
}

// =====""")

# ── learning-service.mjs ─────────────────────────────────────────────────────

# FB-002-13: EmbeddingService.initialize agentic-flow not found (line 480)
for target in [SRC_LEARNING_SERVICE, LOCAL_LEARNING]:
    patch("FB-002-13: learning-service.mjs EmbeddingService init hash fallback",
        target,
        """      console.log('[Embedding] agentic-flow not found, using fallback hash embeddings');""",
        """      console.warn('[RUFLO-FALLBACK] FB-002-13: agentic-flow not found, using hash fallback embeddings');""")

# FB-002-14: EmbeddingService.embed ONNX fail (line 507)
for target in [SRC_LEARNING_SERVICE, LOCAL_LEARNING]:
    patch("FB-002-14: learning-service.mjs embed ONNX fail fallback",
        target,
        """        console.log(`[Embedding] ONNX failed, using fallback: ${e.message}`);""",
        """        console.warn(`[RUFLO-FALLBACK] FB-002-14: ONNX embed failed, using hash fallback`, JSON.stringify({error: e.message}));""")

# FB-002-15: EmbeddingService.embedBatch fail (line 529)
for target in [SRC_LEARNING_SERVICE, LOCAL_LEARNING]:
    patch("FB-002-15: learning-service.mjs embedBatch fail sequential fallback",
        target,
        """      } catch (e) {
        // Fallback to sequential
        return Promise.all(texts.map(t => this.embed(t)));""",
        """      } catch (e) {
        console.warn('[RUFLO-FALLBACK] FB-002-15: embedBatch failed, falling back to sequential', JSON.stringify({error: e.message, batchSize: texts.length}));
        return Promise.all(texts.map(t => this.embed(t)));""")

# ── hook-handler.cjs ─────────────────────────────────────────────────────────

# FB-002-16: route handler keyword-fallback pattern matching
for target in [SRC_HOOK_HANDLER, LOCAL_HOOK]:
    patch("FB-002-16: hook-handler.cjs keyword-fallback routing",
        target,
        """        '  - Matched Pattern: keyword-fallback',""",
        """        '  - Matched Pattern: keyword-fallback [RUFLO-FALLBACK] FB-002-16: keyword-fallback routing active',""")
