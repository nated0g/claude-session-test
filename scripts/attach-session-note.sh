#!/usr/bin/env bash
# Claude Code PostToolUse hook: attaches the current session as a git note after git commit.
# Receives JSON on stdin with session_id, tool_input, etc.

set -euo pipefail

INPUT=$(cat)

# Only care about Bash tool calls
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tool_name',''))" 2>/dev/null)
[ "$TOOL_NAME" = "Bash" ] || exit 0

# Check if the command was a git commit
TOOL_INPUT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tool_input',{}).get('command',''))" 2>/dev/null)
echo "$TOOL_INPUT" | grep -q "git commit" || exit 0

# Don't attach notes for amend or other non-standard commits
echo "$TOOL_INPUT" | grep -q "\-\-amend" && exit 0

# Get session info
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('session_id',''))" 2>/dev/null)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('cwd',''))" 2>/dev/null)

[ -n "$SESSION_ID" ] || exit 0
[ -n "$CWD" ] || exit 0

# Derive project dir name (same logic Claude Code uses)
PROJECT_DIR=$(echo "$CWD" | sed 's|/|-|g')
SESSION_FILE="$HOME/.claude/projects/${PROJECT_DIR}/${SESSION_ID}.jsonl"

[ -f "$SESSION_FILE" ] || exit 0

# Check if we're in a git repo
cd "$CWD"
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null) || exit 0

# Bundle session + subagents into a single file
BUNDLE_FILE=$(mktemp)
trap 'rm -f "$BUNDLE_FILE"' EXIT

# Main session
cp "$SESSION_FILE" "$BUNDLE_FILE"

# Check for subagent sessions
SESSION_DIR="${SESSION_FILE%.jsonl}"
if [ -d "$SESSION_DIR/subagents" ]; then
    for sa in "$SESSION_DIR"/subagents/*.jsonl; do
        [ -f "$sa" ] || continue
        AGENT_ID=$(basename "$sa" .jsonl)
        echo "" >> "$BUNDLE_FILE"
        echo "---SUBAGENT:${AGENT_ID}---" >> "$BUNDLE_FILE"
        cat "$sa" >> "$BUNDLE_FILE"
    done
fi

# Attach as git note (overwrite if exists)
git notes --ref=claude-sessions add -f -F "$BUNDLE_FILE" "$HEAD_SHA" 2>/dev/null || true

exit 0
