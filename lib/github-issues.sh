#!/usr/bin/env bash
# lib/github-issues.sh — GitHub issue/PR creation (ADR-0038)
#
# Sourceable library — no set -euo pipefail.
#
# Expected from pipeline-utils.sh: log(), log_error(), add_cmd_timing()
# Expected from email-notify.sh:   _email_links(), _email_meta(), _email_html_body(), send_email()
# Expected vars from caller:       FORK_NAMES, FORK_DIRS arrays

# ---------------------------------------------------------------------------
# Create sync PR on GitHub
# ---------------------------------------------------------------------------

create_sync_pr() {
  local dir="$1"
  local name="$2"
  local branch="$3"
  local label="$4"
  local body="$5"

  # Push the branch
  local _pr_push_start _pr_push_end
  _pr_push_start=$(date +%s%N 2>/dev/null || echo 0)
  git -C "${dir}" push origin "${branch}" --quiet 2>/dev/null || {
    log_error "Failed to push branch ${branch} for ${name}"
    return 1
  }
  _pr_push_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pr_push_start" != "0" && "$_pr_push_end" != "0" ]]; then
    local _pr_push_ms=$(( (_pr_push_end - _pr_push_start) / 1000000 ))
    log "  git push ${name}/${branch}: ${_pr_push_ms}ms"
    add_cmd_timing "create-pr" "git push ${name}" "${_pr_push_ms}"
  fi

  # Get repo name from remote
  local repo_url
  repo_url=$(git -C "${dir}" remote get-url origin 2>/dev/null) || return 1
  local repo_slug
  repo_slug=$(echo "$repo_url" | sed -E 's#.*github\.com[:/]##; s/\.git$//')

  if [[ -z "$repo_slug" ]]; then
    log_error "Cannot determine GitHub repo slug for ${name}"
    return 1
  fi

  local pr_title="Sync upstream: ${branch}"
  local pr_body="Automated upstream sync.

**Fork**: ${name}
**Branch**: ${branch}
**Status**: ${label}
**Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

${body}"

  log "Creating PR for ${name}: ${pr_title} [${label}]"

  # Create label if it doesn't exist (ignore errors)
  gh label create "$label" --repo "$repo_slug" --force 2>/dev/null || true

  local _pr_create_start _pr_create_end
  _pr_create_start=$(date +%s%N 2>/dev/null || echo 0)
  # Capture PR URL from gh pr create stdout
  local pr_url
  pr_url=$(gh pr create \
    --repo "$repo_slug" \
    --head "$branch" \
    --base main \
    --title "$pr_title" \
    --body "$pr_body" \
    --label "$label" \
    2>/dev/null) || {
      log_error "Failed to create PR for ${name} (non-fatal)"
      pr_url=""
    }
  _pr_create_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pr_create_start" != "0" && "$_pr_create_end" != "0" ]]; then
    local _pr_create_ms=$(( (_pr_create_end - _pr_create_start) / 1000000 ))
    log "  gh pr create ${name}: ${_pr_create_ms}ms"
    add_cmd_timing "create-pr" "gh pr create ${name}" "${_pr_create_ms}"
  fi

  if [[ -n "$pr_url" ]]; then
    log "  PR created: ${pr_url}"
  fi

  # Return PR URL to caller via stdout
  echo "${pr_url}"
}

# ---------------------------------------------------------------------------
# Failure handler: create GitHub issue
# ---------------------------------------------------------------------------

create_failure_issue() {
  local phase="$1"
  local exit_code="$2"

  # Extract fork name from phase if present (e.g., "sync-conflict-ruflo" → "ruflo")
  local fork_name=""
  if [[ "$phase" == *-ruflo ]]; then fork_name="ruflo"
  elif [[ "$phase" == *-agentic-flow ]]; then fork_name="agentic-flow"
  elif [[ "$phase" == *-ruv-FANN ]]; then fork_name="ruv-FANN"
  elif [[ "$phase" == *-ruvector ]]; then fork_name="ruvector"
  fi

  # Collect fork metadata for both GitHub issue and HTML email
  local _bf_fork_url="" _bf_upstream_commit_url="" _bf_fork_commit_url=""
  local fork_info=""
  if [[ -n "$fork_name" ]]; then
    local fork_idx=-1
    for i in "${!FORK_NAMES[@]}"; do
      [[ "${FORK_NAMES[$i]}" == "$fork_name" ]] && fork_idx=$i && break
    done
    if [[ $fork_idx -ge 0 ]]; then
      local dir="${FORK_DIRS[$fork_idx]}"
      local links; links=$(_email_links "$dir" "$fork_name")
      fork_info="\n**Fork**: ${fork_name}${links}"
      _email_meta "$dir"
      _bf_fork_url="$_EML_FORK_URL"
      [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _bf_upstream_commit_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
      [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _bf_fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"
    fi
  fi

  local title="Build failure: ${phase}"

  # GitHub issue body (Markdown, unchanged format)
  local issue_body="The automated ruflo build failed.

**Phase**: ${phase}
**Exit code**: ${exit_code}
**Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Server**: $(hostname)${fork_info}

Check build logs:
\`\`\`bash
journalctl --user -u ruflo-sync --since '$(date -u '+%Y-%m-%d %H:%M:%S UTC')' --no-pager
\`\`\`"

  log_error "Creating failure issue: ${title}"
  gh issue create \
    --title "${title}" \
    --body "${issue_body}" \
    --label "build-failure" \
    2>/dev/null || log_error "Could not create GitHub issue (gh CLI failed)"

  # HTML email body
  local _bf_extra="journalctl --user -u ruflo-sync --since &#39;$(date -u '+%Y-%m-%d %H:%M:%S UTC')&#39; --no-pager"
  local _bf_message="The automated ruflo build failed in phase <strong>${phase}</strong> with exit code ${exit_code}."
  [[ -n "$fork_name" ]] && _bf_message="${_bf_message} Fork: ${fork_name}."
  _bf_message="${_bf_message} Server: $(hostname). Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')."
  local email_body
  email_body=$(_email_html_body "error" \
    "Build failure: ${phase}" \
    "$fork_name" "" "" \
    "" "$_bf_upstream_commit_url" \
    "$_bf_fork_url" "$_bf_fork_commit_url" \
    "$_bf_message" "$_bf_extra")
  send_email "[ruflo] ${title}" "$email_body"
}
