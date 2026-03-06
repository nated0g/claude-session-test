# Claude Code Session Viewer

Automatically renders Claude Code session transcripts as HTML pages on GitHub Pages,
linked from PR comments via git notes.

## How it works

1. A PostToolUse hook captures the session JSONL as a git note after `git commit`
2. On PR open/sync, a GitHub Action extracts notes, renders HTML, deploys to gh-pages
3. A PR comment is posted with links to the rendered session pages
