# ruflo-patch Makefile
#
# Memory symlink management: keeps repo memory in sync with Claude's global store.
# Auto-detects the global project path from $(CURDIR), works in worktrees.
# The global store resolves to ~/.claude/projects/-<path-with-dashes>/memory/
# We symlink it to .claude/memory/ in this repo so memory is version-controlled.

# Derive the Claude project dir name from the current working directory
# Claude uses the absolute path with / replaced by - and leading - stripped
PROJECT_SLUG    := $(shell echo "$(CURDIR)" | tr '/' '-' | sed 's/^-//')
GLOBAL_MEMORY_DIR := $(HOME)/.claude/projects/-$(PROJECT_SLUG)/memory
REPO_MEMORY_DIR   := .claude/memory

.PHONY: setup memory-install memory-copy memory-link memory-status help

setup: memory-install ## Initial project setup (run after clone)
	@echo "Setup complete."

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

memory-install: memory-copy memory-link ## Copy global memory files to repo and install symlink
	@echo "Done. Memory files are in $(REPO_MEMORY_DIR)/, global store symlinked."

memory-copy: ## Copy all memory files from global store to repo
	@mkdir -p $(REPO_MEMORY_DIR)
	@if [ -d "$(GLOBAL_MEMORY_DIR)" ] && [ ! -L "$(GLOBAL_MEMORY_DIR)" ]; then \
		echo "Copying $$(ls $(GLOBAL_MEMORY_DIR) | wc -l) files from global store..."; \
		cp -a $(GLOBAL_MEMORY_DIR)/* $(REPO_MEMORY_DIR)/ 2>/dev/null || true; \
		echo "Copied to $(REPO_MEMORY_DIR)/"; \
	elif [ -L "$(GLOBAL_MEMORY_DIR)" ]; then \
		echo "Global store is already a symlink — nothing to copy."; \
	else \
		echo "No global memory store found at $(GLOBAL_MEMORY_DIR)"; \
	fi

memory-link: ## Replace global memory dir with symlink to repo copy
	@if [ -L "$(GLOBAL_MEMORY_DIR)" ]; then \
		echo "Symlink already exists: $$(readlink $(GLOBAL_MEMORY_DIR))"; \
	elif [ -d "$(GLOBAL_MEMORY_DIR)" ]; then \
		echo "Backing up global store to $(GLOBAL_MEMORY_DIR).bak"; \
		mv $(GLOBAL_MEMORY_DIR) $(GLOBAL_MEMORY_DIR).bak; \
		ln -s $(CURDIR)/$(REPO_MEMORY_DIR) $(GLOBAL_MEMORY_DIR); \
		echo "Symlinked: $(GLOBAL_MEMORY_DIR) -> $(CURDIR)/$(REPO_MEMORY_DIR)"; \
	else \
		mkdir -p $$(dirname $(GLOBAL_MEMORY_DIR)); \
		ln -s $(CURDIR)/$(REPO_MEMORY_DIR) $(GLOBAL_MEMORY_DIR); \
		echo "Symlinked: $(GLOBAL_MEMORY_DIR) -> $(CURDIR)/$(REPO_MEMORY_DIR)"; \
	fi

memory-status: ## Show memory symlink status and file counts
	@echo "Project slug: $(PROJECT_SLUG)"
	@echo "Global store: $(GLOBAL_MEMORY_DIR)"
	@if [ -L "$(GLOBAL_MEMORY_DIR)" ]; then \
		echo "  Type: symlink -> $$(readlink $(GLOBAL_MEMORY_DIR))"; \
	elif [ -d "$(GLOBAL_MEMORY_DIR)" ]; then \
		echo "  Type: directory (not symlinked)"; \
	else \
		echo "  Type: does not exist"; \
	fi
	@echo "Repo memory: $(REPO_MEMORY_DIR)"
	@if [ -d "$(REPO_MEMORY_DIR)" ]; then \
		echo "  Files: $$(ls $(REPO_MEMORY_DIR) | wc -l)"; \
	else \
		echo "  Not found"; \
	fi
