#!/usr/bin/env python3
"""Render a Claude Code session JSONL (+ subagent files) into a standalone HTML page."""

import json
import sys
import os
import html
import re
from pathlib import Path


def escape(text):
    return html.escape(str(text))


def render_diff(old_string, new_string):
    """Render an inline diff between old and new strings."""
    old_lines = old_string.splitlines(keepends=True)
    new_lines = new_string.splitlines(keepends=True)

    result = []
    # Simple line-based diff
    import difflib
    diff = difflib.unified_diff(old_lines, new_lines, lineterm='')
    for line in diff:
        line_esc = escape(line.rstrip('\n'))
        if line.startswith('+++') or line.startswith('---'):
            result.append(f'<span class="diff-header">{line_esc}</span>')
        elif line.startswith('@@'):
            result.append(f'<span class="diff-hunk">{line_esc}</span>')
        elif line.startswith('+'):
            result.append(f'<span class="diff-add">{line_esc}</span>')
        elif line.startswith('-'):
            result.append(f'<span class="diff-del">{line_esc}</span>')
        else:
            result.append(line_esc)
    return '\n'.join(result) if result else f'<span class="diff-add">+{escape(new_string)}</span>'


def render_tool_use(block):
    """Render a tool_use content block."""
    name = block.get('name', 'Unknown')
    inp = block.get('input', {})
    icon = {
        'Bash': '⌘', 'Read': '📄', 'Edit': '✏️', 'Write': '📝',
        'Grep': '🔍', 'Glob': '🔍', 'Task': '🤖', 'WebFetch': '🌐',
        'WebSearch': '🌐',
    }.get(name, '🔧')

    parts = [f'<div class="tool-call">']
    parts.append(f'<details><summary class="tool-summary">{icon} <strong>{escape(name)}</strong>')

    # Add a brief description in the summary line
    if name == 'Bash':
        cmd = inp.get('command', '')
        desc = inp.get('description', '')
        label = desc if desc else (cmd[:80] + '...' if len(cmd) > 80 else cmd)
        parts.append(f' — <code>{escape(label)}</code>')
    elif name == 'Read':
        parts.append(f' — <code>{escape(inp.get("file_path", ""))}</code>')
    elif name in ('Edit', 'Write'):
        parts.append(f' — <code>{escape(inp.get("file_path", ""))}</code>')
    elif name in ('Grep', 'Glob'):
        parts.append(f' — <code>{escape(inp.get("pattern", ""))}</code>')
    elif name == 'Task':
        parts.append(f' — {escape(inp.get("description", ""))}')

    parts.append('</summary>')
    parts.append('<div class="tool-detail">')

    if name == 'Bash':
        cmd = inp.get('command', '')
        parts.append(f'<pre class="command">{escape(cmd)}</pre>')
    elif name == 'Edit':
        old_s = inp.get('old_string', '')
        new_s = inp.get('new_string', '')
        fp = inp.get('file_path', '')
        if old_s or new_s:
            parts.append(f'<div class="diff-container"><pre class="diff">{render_diff(old_s, new_s)}</pre></div>')
    elif name == 'Write':
        content = inp.get('content', '')
        if len(content) > 2000:
            content = content[:2000] + f'\n... ({len(content)} chars total)'
        parts.append(f'<pre class="code">{escape(content)}</pre>')
    elif name == 'Read':
        pass  # Result will show the content
    elif name in ('Grep', 'Glob'):
        for k, v in inp.items():
            if k != 'pattern':
                parts.append(f'<div class="tool-param"><span class="param-name">{escape(k)}:</span> <code>{escape(v)}</code></div>')
    else:
        # Generic: show input as JSON
        parts.append(f'<pre class="code">{escape(json.dumps(inp, indent=2))}</pre>')

    parts.append('</div></details></div>')
    return '\n'.join(parts)


def render_tool_result(block):
    """Render a tool_result content block."""
    content = block.get('content', '')
    is_error = block.get('is_error', False)

    if isinstance(content, list):
        # content can be a list of text/image blocks
        texts = []
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                texts.append(c.get('text', ''))
        content = '\n'.join(texts)

    if not content or content.strip() == '':
        return ''

    err_class = ' error' if is_error else ''
    # Truncate very long results for display
    display = content
    if len(display) > 5000:
        display = display[:5000] + f'\n... ({len(content)} chars total)'

    return f'''<details class="tool-result"><summary class="result-summary{err_class}">{"❌ Error" if is_error else "📋 Result"} ({len(content)} chars)</summary>
<pre class="result-content{err_class}">{escape(display)}</pre></details>'''


def render_text_block(text):
    """Render a text content block with basic markdown-like formatting."""
    escaped = escape(text)
    # Convert markdown code blocks
    escaped = re.sub(r'```(\w*)\n(.*?)```', r'<pre class="code">\2</pre>', escaped, flags=re.DOTALL)
    # Convert inline code
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    # Convert bold
    escaped = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', escaped)
    # Convert newlines to <br> (but not inside <pre>)
    parts = re.split(r'(<pre.*?</pre>)', escaped, flags=re.DOTALL)
    for i, part in enumerate(parts):
        if not part.startswith('<pre'):
            parts[i] = part.replace('\n', '<br>\n')
    return ''.join(parts)


def render_thinking(text):
    """Render a thinking block."""
    display = text
    if len(display) > 3000:
        display = display[:3000] + f'\n... ({len(text)} chars total)'
    return f'''<details class="thinking"><summary class="thinking-summary">💭 Thinking ({len(text)} chars)</summary>
<div class="thinking-content">{render_text_block(display)}</div></details>'''


def extract_agent_id(tool_result_content):
    """Extract agentId from a Task tool_result content string."""
    if not isinstance(tool_result_content, str):
        if isinstance(tool_result_content, list):
            for item in tool_result_content:
                if isinstance(item, dict):
                    text = item.get('text', '')
                    found = extract_agent_id(text)
                    if found:
                        return found
        return None
    m = re.search(r'agentId:\s*(\S+)', tool_result_content)
    return m.group(1) if m else None


def render_inline_subagent(sa_lines, desc):
    """Render a subagent session inline as a collapsible block."""
    inner = process_session(sa_lines, subagents={})
    return f'''<details class="subagent"><summary class="subagent-summary">🤖 Subagent: {escape(desc)}</summary>
{inner}</details>'''


def process_session(lines, label="Main Session", subagents=None):
    """Process session JSONL lines into HTML blocks.

    subagents: dict of agent_id -> (lines, description) for inline rendering
    """
    if subagents is None:
        subagents = {}

    # Build a map of tool_use_id -> agent_id by scanning tool_results
    tool_use_to_agent = {}
    for line_data in lines:
        if line_data.get('type') == 'user':
            content = line_data.get('message', {}).get('content', [])
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_result':
                        agent_id = extract_agent_id(c.get('content', ''))
                        if agent_id:
                            tool_use_to_agent[c.get('tool_use_id', '')] = agent_id

    # Track which tool_use_ids are Task calls
    task_tool_use_ids = {}
    for line_data in lines:
        if line_data.get('type') == 'assistant':
            content = line_data.get('message', {}).get('content', [])
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_use' and c.get('name') == 'Task':
                        task_tool_use_ids[c.get('id', '')] = c.get('input', {}).get('description', '')

    blocks = []
    blocks.append(f'<div class="session-section">')

    for line_data in lines:
        msg_type = line_data.get('type', '')

        if msg_type == 'assistant':
            msg = line_data.get('message', {})
            content = msg.get('content', [])
            if isinstance(content, str):
                blocks.append(f'<div class="msg assistant"><div class="role assistant-role">Assistant</div>{render_text_block(content)}</div>')
            elif isinstance(content, list):
                parts = []
                has_visible = False
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    ct = c.get('type', '')
                    if ct == 'thinking':
                        parts.append(render_thinking(c.get('thinking', '')))
                        has_visible = True
                    elif ct == 'text':
                        text = c.get('text', '').strip()
                        if text:
                            parts.append(render_text_block(text))
                            has_visible = True
                    elif ct == 'tool_use':
                        parts.append(render_tool_use(c))
                        has_visible = True
                if has_visible:
                    blocks.append(f'<div class="msg assistant"><div class="role assistant-role">Assistant</div>{"".join(parts)}</div>')

        elif msg_type == 'user':
            msg = line_data.get('message', {})
            content = msg.get('content', [])
            if isinstance(content, str):
                blocks.append(f'<div class="msg user"><div class="role user-role">User</div>{render_text_block(content)}</div>')
            elif isinstance(content, list):
                text_parts = []
                result_parts = []
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    ct = c.get('type', '')
                    if ct == 'text':
                        text = c.get('text', '').strip()
                        if text and not text.startswith('<'):  # skip system reminders
                            text_parts.append(render_text_block(text))
                    elif ct == 'tool_result':
                        tool_use_id = c.get('tool_use_id', '')
                        # Check if this is a Task result with a subagent to inline
                        agent_id = tool_use_to_agent.get(tool_use_id)
                        if agent_id and agent_id in subagents:
                            sa_lines, sa_desc = subagents[agent_id]
                            result_parts.append(render_inline_subagent(sa_lines, sa_desc))
                        else:
                            r = render_tool_result(c)
                            if r:
                                result_parts.append(r)
                if text_parts:
                    blocks.append(f'<div class="msg user"><div class="role user-role">User</div>{"".join(text_parts)}</div>')
                if result_parts:
                    blocks.append(f'<div class="msg tool-results">{"".join(result_parts)}</div>')

        elif msg_type == 'system':
            msg_text = line_data.get('message', '')
            if isinstance(msg_text, str) and msg_text:
                blocks.append(f'<div class="msg system"><div class="role system-role">System</div>{escape(msg_text)}</div>')

    blocks.append('</div>')
    return '\n'.join(blocks)


def load_session(session_path):
    """Load main session + subagents."""
    lines = []
    with open(session_path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    lines.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    # Check for subagents
    session_dir = session_path.replace('.jsonl', '')
    subagent_sessions = {}
    if os.path.isdir(session_dir):
        subagents_dir = os.path.join(session_dir, 'subagents')
        if os.path.isdir(subagents_dir):
            for sa_file in sorted(os.listdir(subagents_dir)):
                if sa_file.endswith('.jsonl'):
                    sa_path = os.path.join(subagents_dir, sa_file)
                    sa_lines = []
                    with open(sa_path) as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                try:
                                    sa_lines.append(json.loads(line))
                                except json.JSONDecodeError:
                                    continue
                    # Strip .jsonl and optional 'agent-' prefix to match agentId in tool results
                    agent_id = sa_file.replace('.jsonl', '')
                    if agent_id.startswith('agent-'):
                        agent_id = agent_id[6:]
                    # Try to get a description from the first user message
                    desc = agent_id
                    for sl in sa_lines:
                        if sl.get('type') == 'user':
                            msg = sl.get('message', {})
                            c = msg.get('content', '')
                            if isinstance(c, str):
                                desc = c[:80]
                                break
                            elif isinstance(c, list):
                                for cc in c:
                                    if isinstance(cc, dict) and cc.get('type') == 'text':
                                        desc = cc.get('text', '')[:80]
                                        break
                                if desc != agent_id:
                                    break
                    subagent_sessions[agent_id] = (sa_lines, desc)

    return lines, subagent_sessions


def build_html(session_path, commit_sha='unknown'):
    main_lines, subagents = load_session(session_path)

    # Extract metadata from first user message
    version = ''
    for line in main_lines:
        v = line.get('version', '')
        if v:
            version = v
            break

    short_sha = commit_sha[:8]
    main_html = process_session(main_lines, "Main Session", subagents=subagents)

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Code Session — {short_sha}</title>
<style>
:root {{
  --bg: #1e1e2e;
  --surface: #313244;
  --surface2: #181825;
  --text: #cdd6f4;
  --subtext: #a6adc8;
  --dim: #6c7086;
  --blue: #89b4fa;
  --green: #a6e3a1;
  --orange: #fab387;
  --red: #f38ba8;
  --yellow: #f9e2af;
  --mauve: #cba6f7;
  --border-radius: 6px;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  background: var(--bg);
  color: var(--text);
  max-width: 960px;
  margin: 0 auto;
  padding: 20px;
  line-height: 1.5;
}}
h1 {{ color: var(--blue); font-size: 1.3em; margin-bottom: 4px; }}
h2 {{ color: var(--subtext); font-size: 1em; margin: 20px 0 10px; }}
.meta {{ color: var(--dim); font-size: 0.85em; margin-bottom: 24px; }}
.msg {{
  margin: 8px 0;
  padding: 12px;
  border-radius: var(--border-radius);
}}
.user {{
  background: var(--surface);
  border-left: 3px solid var(--blue);
}}
.assistant {{
  background: var(--surface2);
  border-left: 3px solid var(--green);
}}
.system {{
  background: var(--surface2);
  border-left: 3px solid var(--dim);
  font-size: 0.85em;
  color: var(--dim);
}}
.tool-results {{
  margin: 2px 0;
}}
.role {{
  font-weight: 700;
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}}
.user-role {{ color: var(--blue); }}
.assistant-role {{ color: var(--green); }}
.system-role {{ color: var(--dim); }}
/* Tool calls */
.tool-call {{
  margin: 8px 0;
  border: 1px solid #45475a;
  border-radius: var(--border-radius);
  overflow: hidden;
}}
.tool-summary {{
  padding: 8px 12px;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.9em;
  user-select: none;
}}
.tool-summary:hover {{ background: #45475a; }}
.tool-summary code {{ color: var(--subtext); font-size: 0.9em; }}
.tool-detail {{
  padding: 8px 12px;
  background: var(--surface2);
}}
.tool-param {{ font-size: 0.85em; color: var(--dim); margin: 2px 0; }}
.param-name {{ color: var(--mauve); }}
/* Code and results */
pre {{
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.85em;
  padding: 10px;
  border-radius: var(--border-radius);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}}
pre.command {{
  background: #11111b;
  color: var(--green);
  border: 1px solid #45475a;
}}
pre.code {{
  background: #11111b;
  color: var(--text);
  border: 1px solid #45475a;
}}
code {{
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: var(--surface);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}}
/* Tool results */
.tool-result {{
  margin: 4px 0;
}}
.result-summary {{
  padding: 6px 12px;
  background: var(--surface2);
  border: 1px solid #45475a;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 0.85em;
  color: var(--dim);
}}
.result-summary:hover {{ background: var(--surface); }}
.result-summary.error {{ color: var(--red); }}
.result-content {{
  background: #11111b;
  border: 1px solid #45475a;
  margin-top: 4px;
}}
.result-content.error {{
  border-color: var(--red);
  color: var(--red);
}}
/* Diff */
.diff-container {{ margin: 4px 0; }}
pre.diff {{
  background: #11111b;
  border: 1px solid #45475a;
}}
.diff-header {{ color: var(--dim); }}
.diff-hunk {{ color: var(--mauve); }}
.diff-add {{ color: var(--green); background: rgba(166,227,161,0.1); display: inline-block; width: 100%; }}
.diff-del {{ color: var(--red); background: rgba(243,139,168,0.1); display: inline-block; width: 100%; }}
/* Thinking */
.thinking {{
  margin: 8px 0;
}}
.thinking-summary {{
  padding: 6px 12px;
  background: var(--surface2);
  border: 1px solid #45475a;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 0.85em;
  color: var(--mauve);
}}
.thinking-summary:hover {{ background: var(--surface); }}
.thinking-content {{
  padding: 10px 12px;
  font-size: 0.85em;
  color: var(--subtext);
  border: 1px solid #45475a;
  border-top: none;
  border-radius: 0 0 var(--border-radius) var(--border-radius);
}}
/* Subagents */
.subagent {{
  margin: 12px 0;
  border: 1px solid var(--mauve);
  border-radius: var(--border-radius);
}}
.subagent-summary {{
  padding: 10px 14px;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.95em;
  color: var(--mauve);
}}
.subagent-summary:hover {{ background: #45475a; }}
.session-section {{ margin: 0; }}
</style>
</head>
<body>
<h1>Claude Code Session</h1>
<div class="meta">Commit: {escape(commit_sha)}{f' | Claude Code {escape(version)}' if version else ''}</div>
{main_html}
</body>
</html>'''


def main():
    if len(sys.argv) < 2:
        print("Usage: render-session.py <session.jsonl> [commit_sha]", file=sys.stderr)
        sys.exit(1)

    session_path = sys.argv[1]
    commit_sha = sys.argv[2] if len(sys.argv) > 2 else 'unknown'

    print(build_html(session_path, commit_sha))


if __name__ == '__main__':
    main()
