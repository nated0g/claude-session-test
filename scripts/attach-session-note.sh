#!/usr/bin/env bash
# Claude Code PostToolUse hook: attaches the current session as a git note after git commit.
# Produces bundled JSONL: main session + ---SUBAGENT:id---\n delimited subagents.
# Receives JSON on stdin with session_id, tool_input, cwd, etc.

set -euo pipefail

INPUT=$(cat)

# Only care about Bash tool calls that contain "git commit" (not --amend)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('tool_input',{}).get('command',''))" 2>/dev/null)
echo "$COMMAND" | grep -q "git commit" || exit 0
echo "$COMMAND" | grep -q "\-\-amend" && exit 0

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

# Figure out the git working directory
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

# Bundle session + subagents as raw JSONL with ---SUBAGENT:id--- delimiters
BUNDLE_FILE="/tmp/claude-session-bundle-$$.jsonl"
cp "$SESSION_FILE" "$BUNDLE_FILE"

SESSION_DIR="${SESSION_FILE%.jsonl}"
SUBAGENTS_DIR="${SESSION_DIR}/subagents"

if [ -d "$SUBAGENTS_DIR" ]; then
    for sa_file in "$SUBAGENTS_DIR"/*.jsonl; do
        [ -f "$sa_file" ] || continue
        agent_id=$(basename "$sa_file" .jsonl)
        printf '\n---SUBAGENT:%s---\n' "$agent_id" >> "$BUNDLE_FILE"
        cat "$sa_file" >> "$BUNDLE_FILE"
    done
fi

# Attach as git note
git notes --ref=claude-sessions add -f -F "$BUNDLE_FILE" "$HEAD_SHA" 2>/dev/null || true
rm -f "$BUNDLE_FILE"

# Push the note ref so CI can fetch it
git push origin refs/notes/claude-sessions 2>/dev/null || true

exit 0
