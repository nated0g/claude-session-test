#!/usr/bin/env bash
# Claude Code PostToolUse hook: attaches the current session as a git note after git commit.
# Receives JSON on stdin with session_id, tool_input, cwd, etc.

set -euo pipefail

INPUT=$(cat)

# Only care about Bash tool calls
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tool_name',''))" 2>/dev/null)
[ "$TOOL_NAME" = "Bash" ] || exit 0

# Check if the command contained a git commit
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tool_input',{}).get('command',''))" 2>/dev/null)
echo "$COMMAND" | grep -q "git commit" || exit 0

# Don't attach notes for amend
echo "$COMMAND" | grep -q "\-\-amend" && exit 0

# Check if the tool reported an error (commit might have failed)
TOOL_ERROR=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tool_error', False))" 2>/dev/null)
[ "$TOOL_ERROR" = "True" ] && exit 0

# Get session info
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('session_id',''))" 2>/dev/null)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('cwd',''))" 2>/dev/null)

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

# Figure out the git working directory.
# If the command starts with "cd /some/path &&", extract that path.
# Otherwise fall back to the hook's CWD.
GIT_DIR="$CWD"
CD_PATH=$(echo "$COMMAND" | python3 -c "
import sys, re
cmd = sys.stdin.read()
m = re.match(r'cd\s+(\S+)\s*&&', cmd)
print(m.group(1) if m else '')
" 2>/dev/null)
[ -n "$CD_PATH" ] && GIT_DIR="$CD_PATH"

# Check if we're in a git repo
cd "$GIT_DIR"
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
