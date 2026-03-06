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

# Bundle session + subagents as base64-encoded JSON manifest
SESSION_DIR="${SESSION_FILE%.jsonl}"

python3 -c "
import json, base64, os, sys

session_file = sys.argv[1]
session_dir = sys.argv[2]

manifest = {}

with open(session_file, 'rb') as f:
    manifest['main'] = base64.b64encode(f.read()).decode('ascii')

subagents_dir = os.path.join(session_dir, 'subagents')
if os.path.isdir(subagents_dir):
    manifest['subagents'] = {}
    for sa_file in sorted(os.listdir(subagents_dir)):
        if sa_file.endswith('.jsonl'):
            sa_path = os.path.join(subagents_dir, sa_file)
            agent_id = sa_file[:-6]  # strip .jsonl
            with open(sa_path, 'rb') as f:
                manifest['subagents'][agent_id] = base64.b64encode(f.read()).decode('ascii')

json.dump(manifest, sys.stdout)
" "$SESSION_FILE" "$SESSION_DIR" > /tmp/claude-session-manifest-$$.json

# Attach as git note
git notes --ref=claude-sessions add -f -F /tmp/claude-session-manifest-$$.json "$HEAD_SHA" 2>/dev/null || true
rm -f /tmp/claude-session-manifest-$$.json

exit 0
