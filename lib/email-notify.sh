#!/usr/bin/env bash
# lib/email-notify.sh — Email notification helpers (ADR-0038)
#
# Sourceable library — expects log() to be defined by the caller
# (typically from pipeline-utils.sh).

# Get the GitHub web URL for a fork directory (strips .git suffix)
_fork_url() {
  local dir="$1"
  local url
  url=$(git -C "${dir}" remote get-url origin 2>/dev/null) || echo ""
  # Convert SSH URLs (git@github.com:user/repo.git) to HTTPS
  url="${url%.git}"
  url=$(echo "$url" | sed -E 's|^git@github\.com:|https://github.com/|')
  echo "$url"
}

# Get the upstream GitHub web URL for a fork directory
_upstream_url() {
  local dir="$1"
  local url
  url=$(git -C "${dir}" remote get-url upstream 2>/dev/null) || echo ""
  url="${url%.git}"
  url=$(echo "$url" | sed -E 's|^git@github\.com:|https://github.com/|')
  echo "$url"
}

# Build a link block for email body: upstream commit, fork repo, fork commit
_email_links() {
  local dir="$1" name="$2"
  local fork_url upstream_url upstream_sha fork_sha links=""

  fork_url=$(_fork_url "$dir")
  upstream_url=$(_upstream_url "$dir")
  upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || upstream_sha=""
  fork_sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || fork_sha=""

  if [[ -n "$upstream_url" && -n "$upstream_sha" ]]; then
    links="${links}\nUpstream commit: ${upstream_url}/commit/${upstream_sha}"
  fi
  if [[ -n "$fork_url" ]]; then
    links="${links}\nFork repo: ${fork_url}"
  fi
  if [[ -n "$fork_url" && -n "$fork_sha" ]]; then
    links="${links}\nFork commit: ${fork_url}/commit/${fork_sha}"
  fi
  echo "$links"
}

# Collect email metadata from a fork directory into associative-style variables.
# Sets: _EML_FORK_URL, _EML_UPSTREAM_URL, _EML_UPSTREAM_SHA, _EML_FORK_SHA
_email_meta() {
  local dir="$1"
  _EML_FORK_URL=$(_fork_url "$dir")
  _EML_UPSTREAM_URL=$(_upstream_url "$dir")
  _EML_UPSTREAM_SHA=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || _EML_UPSTREAM_SHA=""
  _EML_FORK_SHA=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || _EML_FORK_SHA=""
  _EML_UPSTREAM_MSG=$(git -C "${dir}" log upstream/main -1 --format='%B' 2>/dev/null | head -5 | sed '/^$/d') || _EML_UPSTREAM_MSG=""
}

# Generate an HTML email body for pipeline notifications.
#
# Arguments (positional):
#   1  status       "success" | "error" | "warning"
#   2  title        Headline text
#   3  fork_name    Which fork (e.g. "ruflo")
#   4  branch       Branch name
#   5  branch_url   URL to branch on GitHub (may be empty)
#   6  pr_url       PR link (may be empty)
#   7  upstream_commit_url  Link to upstream commit (may be empty)
#   8  fork_url     Link to fork repo (may be empty)
#   9  fork_commit_url  Link to fork commit (may be empty)
#  10  message      Main status message
#  11  extra        Optional extra text (e.g. journal command)
_email_html_body() {
  local status="$1"
  local title="$2"
  local fork_name="$3"
  local branch="$4"
  local branch_url="$5"
  local pr_url="$6"
  local upstream_commit_url="$7"
  local fork_url="$8"
  local fork_commit_url="$9"
  local message="${10}"
  local extra="${11:-}"

  local color
  case "$status" in
    success) color="#22c55e" ;;
    warning) color="#f59e0b" ;;
    *)       color="#ef4444" ;;
  esac

  local status_label
  case "$status" in
    success) status_label="SUCCESS" ;;
    warning) status_label="WARNING" ;;
    *)       status_label="ERROR" ;;
  esac

  # ── Build metadata rows ──
  local td_label="padding:8px 12px;font-weight:600;color:#374151;white-space:nowrap;border-bottom:1px solid #f3f4f6"
  local td_value="padding:8px 12px;border-bottom:1px solid #f3f4f6"
  local link_style="color:#2563eb;text-decoration:underline"
  local mono="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px"
  local rows=""

  # 1. Fork Repo
  if [[ -n "$fork_name" ]]; then
    if [[ -n "$fork_url" ]]; then
      rows="${rows}<tr><td style=\"${td_label}\">Fork Repo</td><td style=\"${td_value}\"><a href=\"${fork_url}\" style=\"${link_style}\">${fork_name}</a></td></tr>"
    else
      rows="${rows}<tr><td style=\"${td_label}\">Fork Repo</td><td style=\"${td_value}\">${fork_name}</td></tr>"
    fi
  fi

  # 2. Fork Branch
  if [[ -n "$branch" ]]; then
    local branch_cell="${branch}"
    [[ -n "$branch_url" ]] && branch_cell="<a href=\"${branch_url}\" style=\"${link_style};${mono}\">${branch}</a>"
    rows="${rows}<tr><td style=\"${td_label}\">Fork Branch</td><td style=\"${td_value}\">${branch_cell}</td></tr>"
  fi

  # 3. Fork Commit
  if [[ -n "$fork_commit_url" ]]; then
    local fork_short="${fork_commit_url##*/}"
    fork_short="${fork_short:0:8}"
    rows="${rows}<tr><td style=\"${td_label}\">Fork Commit</td><td style=\"${td_value}\"><a href=\"${fork_commit_url}\" style=\"${link_style};${mono}\">${fork_short}</a></td></tr>"
  fi

  # 4. Fork Pull Request
  if [[ -n "$pr_url" ]]; then
    local pr_label="View PR"
    local pr_num="${pr_url##*/pull/}"
    [[ "$pr_num" != "$pr_url" && "$pr_num" =~ ^[0-9]+$ ]] && pr_label="PR #${pr_num}"
    rows="${rows}<tr><td style=\"${td_label}\">Fork Pull Request</td><td style=\"${td_value}\"><a href=\"${pr_url}\" style=\"${link_style}\">${pr_label}</a></td></tr>"
  fi

  # 5. Upstream Commit
  if [[ -n "$upstream_commit_url" ]]; then
    local upstream_short="${upstream_commit_url##*/}"
    upstream_short="${upstream_short:0:8}"
    rows="${rows}<tr><td style=\"${td_label}\">Upstream Commit</td><td style=\"${td_value}\"><a href=\"${upstream_commit_url}\" style=\"${link_style};${mono}\">${upstream_short}</a></td></tr>"
  fi

  # ── Upstream commit message block ──
  local commit_msg_html=""
  if [[ -n "${_EML_UPSTREAM_MSG:-}" ]]; then
    local safe_msg="${_EML_UPSTREAM_MSG}"
    safe_msg="${safe_msg//&/&amp;}"
    safe_msg="${safe_msg//</&lt;}"
    safe_msg="${safe_msg//>/&gt;}"
    safe_msg="${safe_msg//$'\n'/<br>}"
    # Auto-link URLs
    safe_msg=$(echo "$safe_msg" | sed -E 's|(https?://[^ <]+)|<a href="\1" style="color:#2563eb;text-decoration:underline">\1</a>|g')
    # Auto-link #NNN issue/PR references to upstream repo
    if [[ -n "${_EML_UPSTREAM_URL:-}" ]]; then
      safe_msg=$(echo "$safe_msg" | sed -E "s|#([0-9]+)|<a href=\"${_EML_UPSTREAM_URL}/pull/\1\" style=\"color:#2563eb;text-decoration:underline\">#\1</a>|g")
    fi
    commit_msg_html="<div style=\"margin-top:16px\"><div style=\"font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px\">Upstream Commit Message</div><div style=\"padding:10px 0;background:#f9fafb;border-left:3px solid ${color};padding-left:12px;font-size:13px;color:#374151;line-height:1.6\">${safe_msg}</div></div>"
  fi

  # ── Error/debug output block ──
  local extra_html=""
  if [[ -n "$extra" ]]; then
    extra_html="<div style=\"margin-top:16px\"><div style=\"font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px\">Error Details</div><pre style=\"margin:0;padding:10px 0 10px 12px;background:#f9fafb;border-left:3px solid ${color};${mono};font-size:12px;color:#374151;line-height:1.6;white-space:pre-wrap;overflow-x:auto\">${extra}</pre></div>"
  fi

  cat <<EMAILHTML
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif">
<div style="height:4px;background:${color}"></div>
<div style="padding:20px">
<table cellpadding="0" cellspacing="0" style="width:100%"><tr>
<td><span style="display:inline-block;padding:3px 8px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.5px;color:#ffffff;background:${color}">${status_label}</span></td>
<td style="text-align:right;font-size:12px;color:#9ca3af">$(date -u '+%Y-%m-%d %H:%M UTC')</td>
</tr></table>
<h1 style="margin:10px 0 6px 0;font-size:18px;font-weight:600;color:#111827">${title}</h1>
<p style="margin:0 0 16px 0;font-size:14px;color:#4b5563;line-height:1.5">${message}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${rows}
</table>
${commit_msg_html}
${extra_html}
<div style="margin-top:20px;padding-top:12px;border-top:1px solid #f3f4f6">
<p style="margin:0;font-size:11px;color:#9ca3af">Ruflo Patch Monitor &mdash; <a href="https://github.com/sparkling/ruflo-patch" style="color:#9ca3af">ruflo-patch</a></p>
</div>
</div>
</body>
</html>
EMAILHTML
}

send_email() {
  local subject="$1"
  local body="$2"
  local recipient="${RUFLO_NOTIFY_EMAIL:-}"

  if [[ -z "$recipient" ]]; then
    log "Email notification (no recipient configured): ${subject}"
    return 0
  fi

  if command -v sendmail &>/dev/null; then
    printf 'From: Ruflo Patch Monitor <do-not-reply-ruflo-patching-monitor@sparklingideas.co.uk>\nTo: %s\nSubject: %s\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n%s\n' \
      "$recipient" "$subject" "$body" | sendmail "$recipient" 2>/dev/null || {
      log "WARNING: sendmail failed for: ${subject}"
    }
  elif command -v mail &>/dev/null; then
    echo "$body" | mail -s "$subject" -a "Content-Type: text/html; charset=utf-8" "$recipient" 2>/dev/null || {
      log "WARNING: mail failed for: ${subject}"
    }
  else
    log "Email notification (no mail command): ${subject}"
  fi
}
