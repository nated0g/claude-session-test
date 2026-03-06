#!/usr/bin/env bash
# Claude Code PostToolUse hook: attaches the current session as a git note after git commit.
# Produces base64 JSON envelope: {"main":"b64...","subagents":{"id":"b64...",...}}
# CI decodes this into raw JSONL for the viewer. Base64 avoids escaping issues in git notes.
# Receives JSON on stdin with session_id, tool_input, cwd, etc.
# Requires: jq, base64

set -euo pipefail

INPUT=$(cat)

# Only care about Bash tool calls that contain "git commit" (not --amend)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
echo "$COMMAND" | grep -q "git commit" || exit 0
echo "$COMMAND" | grep -q "\-\-amend" && exit 0

# Get session info
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')

[ -n "$SESSION_ID" ] || exit 0
[ -n "$CWD" ] || exit 0

# Find session file by ID across all project dirs
SESSION_FILE=""
for dir in "$HOME"/.claude/projects/*/; do
    candidate="${dir}${SESSION_ID}.jsonl"
    if [ -f "$candidate" ]; then
        SESSION_FILE="$candidate"
        break
    fi
done

[ -n "$SESSION_FILE" ] || exit 0

# Figure out the git working directory
GIT_DIR="$CWD"
CD_PATH=$(echo "$COMMAND" | sed -n 's/^cd \([^ ]*\) *&&.*/\1/p')
[ -n "$CD_PATH" ] && GIT_DIR="$CD_PATH"

# Check if we're in a git repo
cd "$GIT_DIR"
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null) || exit 0

# Bundle as base64 JSON envelope
BUNDLE_FILE="/tmp/claude-session-bundle-$$.json"
SESSION_DIR="${SESSION_FILE%.jsonl}"
SUBAGENTS_DIR="${SESSION_DIR}/subagents"

# Start with main session
MAIN_B64=$(base64 < "$SESSION_FILE")
ENVELOPE=$(jq -n --arg main "$MAIN_B64" --arg sid "$SESSION_ID" '{session_id: $sid, main: $main, subagents: {}}')

# Add subagents if present
if [ -d "$SUBAGENTS_DIR" ]; then
    for sa_file in "$SUBAGENTS_DIR"/*.jsonl; do
        [ -f "$sa_file" ] || continue
        agent_id=$(basename "$sa_file" .jsonl)
        sa_b64=$(base64 < "$sa_file")
        ENVELOPE=$(echo "$ENVELOPE" | jq --arg id "$agent_id" --arg b64 "$sa_b64" '.subagents[$id] = $b64')
    done
fi

echo "$ENVELOPE" > "$BUNDLE_FILE"

# Attach as git note
git notes --ref=claude-sessions add -f -F "$BUNDLE_FILE" "$HEAD_SHA" 2>/dev/null || true
rm -f "$BUNDLE_FILE"

# Push the note ref — merge remote first to avoid non-fast-forward rejection
git fetch origin refs/notes/claude-sessions:refs/notes/claude-sessions-remote 2>/dev/null \
  && git notes --ref=claude-sessions merge refs/notes/claude-sessions-remote 2>/dev/null || true
git push origin refs/notes/claude-sessions 2>/dev/null || true

exit 0
