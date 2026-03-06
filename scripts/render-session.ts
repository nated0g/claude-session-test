#!/usr/bin/env tsx
/**
 * Render a Claude Code session JSONL into a standalone HTML page.
 *
 * Usage: tsx render-session.ts <session.jsonl> <commit_sha> [--author <name>] [--repo-url <url>]
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { basename, join, extname } from "path";
import { createTwoFilesPatch } from "diff";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

interface SessionMessage {
  type: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  version?: string;
  uuid?: string;
  isMeta?: boolean;
  timestamp?: string;
}

interface ToolResultMap {
  [toolUseId: string]: ContentBlock;
}

// ── CLI Args ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[++i];
    } else {
      positional.push(args[i]);
    }
  }

  if (positional.length < 2) {
    console.error(
      "Usage: tsx render-session.ts <session.jsonl> <commit_sha> [--author <name>] [--repo-url <url>]"
    );
    process.exit(1);
  }

  return {
    sessionPath: positional[0],
    commitSha: positional[1],
    author: opts["author"] || "User",
    repoUrl: (opts["repo-url"] || "").replace(/\/$/, ""),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".sql": "sql",
  ".md": "markdown",
  ".dockerfile": "dockerfile",
  ".tf": "hcl",
  ".lua": "lua",
  ".r": "r",
  ".svelte": "html",
  ".vue": "html",
};

function langFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
  const base = basename(filePath).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  if (base === "justfile") return "makefile";
  if (base.endsWith(".env")) return "bash";
  return "";
}

function fileLink(filePath: string, repoUrl: string, commitSha: string): string {
  if (!repoUrl) return `<span class="file-path">${esc(filePath)}</span>`;
  // Strip leading / or absolute paths — try to make relative to repo root
  let rel = filePath;
  // Common patterns: /home/runner/work/repo/repo/file or /Users/.../repo/file
  const repoName = repoUrl.split("/").pop() || "";
  const idx = rel.indexOf(`/${repoName}/`);
  if (idx !== -1) {
    rel = rel.slice(idx + repoName.length + 2);
  } else if (rel.startsWith("/")) {
    // Just use basename-ish path for local files
    rel = filePath;
  }
  const url = `${repoUrl}/blob/${commitSha}/${rel}`;
  return `<a class="file-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(filePath)}</a>`;
}

function shortPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return `${parts.slice(0, 1).join("/")}/.../` + parts.slice(-2).join("/");
}

// ── Diff rendering ─────────────────────────────────────────────────────────────

function renderDiff(
  oldStr: string,
  newStr: string,
  filePath: string,
  lang?: string
): string {
  const patch = createTwoFilesPatch(filePath, filePath, oldStr, newStr, "", "");
  const lines = patch.split("\n");

  // Skip the first two header lines (diff/---)
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("@@")) {
      startIdx = i;
      break;
    }
  }

  const out: string[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)/);
      if (match) {
        oldLine = parseInt(match[1], 10) - 1;
        newLine = oldLine; // approximate
      }
      const matchNew = line.match(/\+(\d+)/);
      if (matchNew) newLine = parseInt(matchNew[1], 10) - 1;
      out.push(`<tr class="diff-hunk"><td class="diff-ln"></td><td class="diff-ln"></td><td class="diff-marker"></td><td>${esc(line)}</td></tr>`);
    } else if (line.startsWith("+")) {
      newLine++;
      out.push(
        `<tr class="diff-add"><td class="diff-ln"></td><td class="diff-ln">${newLine}</td><td class="diff-marker">+</td><td>${esc(line.slice(1))}</td></tr>`
      );
    } else if (line.startsWith("-")) {
      oldLine++;
      out.push(
        `<tr class="diff-del"><td class="diff-ln">${oldLine}</td><td class="diff-ln"></td><td class="diff-marker">-</td><td>${esc(line.slice(1))}</td></tr>`
      );
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file"
      continue;
    } else {
      oldLine++;
      newLine++;
      out.push(
        `<tr class="diff-ctx"><td class="diff-ln">${oldLine}</td><td class="diff-ln">${newLine}</td><td class="diff-marker"> </td><td>${esc(line.slice(1) || "")}</td></tr>`
      );
    }
  }

  const langAttr = lang ? ` data-lang="${lang}"` : "";
  return `<table class="diff-table"${langAttr}>${out.join("\n")}</table>`;
}

// ── Markdown-lite rendering ────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  let escaped = esc(text);

  // Fenced code blocks: ```lang\n...\n```
  escaped = escaped.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const cls = lang ? ` class="language-${lang}"` : "";
      return `<pre><code${cls}>${code}</code></pre>`;
    }
  );

  // Inline code
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Line breaks (not inside <pre>)
  const parts = escaped.split(/(<pre>[\s\S]*?<\/pre>)/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith("<pre>")) {
      parts[i] = parts[i].replace(/\n/g, "<br>\n");
    }
  }

  return parts.join("");
}

// ── Tool rendering ─────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  Bash: "terminal",
  Read: "file",
  Edit: "edit",
  Write: "file-plus",
  Grep: "search",
  Glob: "search",
  Task: "cpu",
  WebFetch: "globe",
  WebSearch: "globe",
  EnterPlanMode: "map",
  AskUserQuestion: "help-circle",
};

function toolIcon(name: string): string {
  const icon = TOOL_ICONS[name] || "tool";
  // SVG icons inline (simple, no external dep)
  const svgs: Record<string, string> = {
    terminal: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    file: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    "file-plus": `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    cpu: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
    globe: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    map: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
    "help-circle": `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    tool: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  };
  return svgs[icon] || svgs.tool;
}

function renderToolUse(
  block: ContentBlock,
  result: ContentBlock | null,
  repoUrl: string,
  commitSha: string
): string {
  const name = block.name || "Unknown";
  const inp = (block.input || {}) as Record<string, string>;
  const icon = toolIcon(name);

  let summaryLabel = "";
  let detail = "";

  switch (name) {
    case "Bash": {
      const cmd = inp.command || "";
      const desc = inp.description || "";
      const firstActionLine = cmd.split("\n").find(l => {
        const trimmed = l.trim();
        return trimmed && !trimmed.startsWith("#");
      }) || cmd.split("\n")[0];
      const cmdPreview = firstActionLine.length > 80 ? firstActionLine.slice(0, 80) + "..." : firstActionLine;
      summaryLabel = desc
        ? `<span class="tool-cmd-preview">${esc(cmdPreview)}</span><span class="tool-desc">${esc(desc)}</span>`
        : `<span class="tool-cmd-preview">${esc(cmdPreview)}</span>`;
      detail = `<pre><code class="language-bash">${esc(cmd)}</code></pre>`;
      break;
    }
    case "Read": {
      const fp = inp.file_path || "";
      summaryLabel = shortPath(fp);
      detail = `<div class="tool-file-header">${fileLink(fp, repoUrl, commitSha)}</div>`;
      break;
    }
    case "Edit": {
      const fp = inp.file_path || "";
      const oldStr = inp.old_string || "";
      const newStr = inp.new_string || "";
      const lang = langFromPath(fp);
      const addCount = newStr.split("\n").length;
      const delCount = oldStr.split("\n").length;
      summaryLabel = `${shortPath(fp)}`;
      const badge = `<span class="diff-badge"><span class="diff-badge-add">+${addCount}</span> <span class="diff-badge-del">-${delCount}</span></span>`;
      summaryLabel = `${shortPath(fp)} ${badge}`;
      detail = `<div class="tool-file-header">${fileLink(fp, repoUrl, commitSha)}</div>`;
      if (oldStr || newStr) {
        detail += `<div class="diff-container">${renderDiff(oldStr, newStr, fp, lang)}</div>`;
      }
      break;
    }
    case "Write": {
      const fp = inp.file_path || "";
      const content = inp.content || "";
      const lang = langFromPath(fp);
      const lineCount = content.split("\n").length;
      summaryLabel = `${shortPath(fp)} <span class="diff-badge"><span class="diff-badge-add">+${lineCount}</span></span>`;
      detail = `<div class="tool-file-header">${fileLink(fp, repoUrl, commitSha)}</div>`;
      const displayContent =
        content.length > 5000
          ? content.slice(0, 5000) + `\n... (${content.length} chars total)`
          : content;
      const cls = lang ? ` class="language-${lang}"` : "";
      detail += `<pre><code${cls}>${esc(displayContent)}</code></pre>`;
      break;
    }
    case "Grep": {
      const pattern = inp.pattern || "";
      const path = inp.path || "";
      summaryLabel = `"${pattern}"${path ? ` in ${shortPath(path)}` : ""}`;
      break;
    }
    case "Glob": {
      const pattern = inp.pattern || "";
      summaryLabel = pattern;
      break;
    }
    case "Task": {
      summaryLabel = (inp.description as string) || "Subagent task";
      break;
    }
    case "AskUserQuestion": {
      const questions = (block.input as Record<string, unknown>)?.questions as Array<Record<string, unknown>> | undefined;
      if (questions && questions.length > 0) {
        const q = questions[0];
        summaryLabel = (q.question as string) || "Question";
        let questionHtml = `<div class="ask-question">`;
        questionHtml += `<div class="ask-question-text">${esc(q.question as string || "")}</div>`;
        const options = q.options as Array<Record<string, string>> | undefined;
        if (options) {
          questionHtml += `<div class="ask-options">`;
          for (const opt of options) {
            questionHtml += `<div class="ask-option"><span class="ask-option-label">${esc(opt.label || "")}</span>`;
            if (opt.description) {
              questionHtml += `<span class="ask-option-desc">${esc(opt.description)}</span>`;
            }
            questionHtml += `</div>`;
          }
          questionHtml += `</div>`;
        }
        questionHtml += `</div>`;
        detail = questionHtml;
      } else {
        summaryLabel = "Question";
        const inputStr = JSON.stringify(block.input || {}, null, 2);
        detail = `<pre><code class="language-json">${esc(inputStr)}</code></pre>`;
      }
      break;
    }
    default: {
      summaryLabel = name;
      const inputStr = JSON.stringify(block.input || {}, null, 2);
      if (inputStr !== "{}") {
        detail = `<pre><code class="language-json">${esc(inputStr)}</code></pre>`;
      }
    }
  }

  // Render the result inline
  let resultHtml = "";
  if (result) {
    const resultContent = extractResultContent(result);
    const isError = result.is_error || false;

    if (resultContent.trim()) {
      const errClass = isError ? " error" : "";
      const charCount = resultContent.length;
      const displayResult =
        resultContent.length > 8000
          ? resultContent.slice(0, 8000) + `\n... (${resultContent.length} chars total)`
          : resultContent;

      // For Read tool, try to syntax-highlight the result
      let resultCode = "";
      if (name === "Read" && inp.file_path) {
        const lang = langFromPath(inp.file_path);
        const cls = lang ? ` class="language-${lang}"` : "";
        resultCode = `<pre class="tool-result-content${errClass}"><code${cls}>${esc(displayResult)}</code></pre>`;
      } else {
        resultCode = `<pre class="tool-result-content${errClass}"><code>${esc(displayResult)}</code></pre>`;
      }

      if (name === "Bash") {
        // Bash: show output directly, no collapse
        resultHtml = `<div class="tool-result-inline${errClass}"><div class="tool-result-header">${isError ? "Error" : "Output"} <span class="result-size">${charCount.toLocaleString()} chars</span></div>${resultCode}</div>`;
      } else {
        // Everything else: collapsible
        const resultLabel = isError ? "Error" : "Output";
        resultHtml = `<details class="tool-result-details${errClass}"><summary class="tool-result-summary">${resultLabel} <span class="result-size">${charCount.toLocaleString()} chars</span></summary>${resultCode}</details>`;
      }
    }
  }

  // Don't HTML-escape the summaryLabel since it may contain our badge HTML
  const openByDefault = name === "Edit" || name === "Write";
  return `<div class="tool-block">
<details${openByDefault ? " open" : ""}>
<summary class="tool-summary"><span class="tool-icon">${icon}</span><span class="tool-name">${esc(name)}</span><span class="tool-label">${summaryLabel}</span></summary>
<div class="tool-detail">${detail}${resultHtml}</div>
</details>
</div>`;
}

function extractResultContent(block: ContentBlock): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => typeof c === "object" && c.type === "text")
      .map((c) => (c as ContentBlock).text || "")
      .join("\n");
  }
  return "";
}

// ── Build tool result map ──────────────────────────────────────────────────────

function buildToolResultMap(messages: SessionMessage[]): ToolResultMap {
  const map: ToolResultMap = {};
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const content = msg.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        map[block.tool_use_id] = block;
      }
    }
  }
  return map;
}

// ── Render thinking ────────────────────────────────────────────────────────────

function renderThinking(text: string): string {
  const display = text.length > 5000 ? text.slice(0, 5000) + `\n... (${text.length} chars)` : text;
  return `<details class="thinking-block"><summary class="thinking-summary"><span class="tool-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>Thinking <span class="result-size">${text.length.toLocaleString()} chars</span></summary><div class="thinking-content">${renderMarkdown(display)}</div></details>`;
}

// ── Process session ────────────────────────────────────────────────────────────

// Render a single message into HTML, returning { role, html } or null if skipped
function renderMessage(
  msg: SessionMessage,
  toolResultMap: ToolResultMap,
  repoUrl: string,
  commitSha: string,
  author: string
): { role: "user" | "assistant" | "system"; html: string } | null {
  if (
    msg.type === "file-history-snapshot" ||
    msg.type === "progress" ||
    msg.type === "queue-operation" ||
    msg.type === "pr-link" ||
    msg.isMeta
  ) {
    return null;
  }

  if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (!content) return null;

    if (typeof content === "string") {
      if (!content.trim()) return null;
      return { role: "assistant", html: `<div class="msg-item">${renderMarkdown(content.trim())}</div>` };
    }

    const parts: string[] = [];
    for (const c of content) {
      if (c.type === "thinking" && c.thinking) {
        parts.push(renderThinking(c.thinking));
      } else if (c.type === "text" && c.text?.trim()) {
        parts.push(`<div class="msg-text">${renderMarkdown(c.text.trim())}</div>`);
      } else if (c.type === "tool_use") {
        const result = c.id ? toolResultMap[c.id] || null : null;
        parts.push(renderToolUse(c, result, repoUrl, commitSha));
      }
    }

    if (parts.length === 0) return null;
    return { role: "assistant", html: `<div class="msg-item">${parts.join("\n")}</div>` };
  }

  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!content) return null;

    if (typeof content === "string") {
      if (content.startsWith("<") && !content.startsWith("<!")) return null;
      if (!content.trim()) return null;
      return { role: "user", html: `<div class="msg-item">${renderMarkdown(content)}</div>` };
    }

    const textParts: string[] = [];
    for (const c of content) {
      if (c.type === "text" && c.text?.trim()) {
        if (c.text.startsWith("<local-command") || c.text.startsWith("<command-")) continue;
        if (c.text.startsWith("<system-reminder")) continue;
        if (c.text.startsWith("<local-command-stdout")) continue;
        textParts.push(c.text);
      }
    }

    if (textParts.length === 0) return null;
    return { role: "user", html: `<div class="msg-item">${renderMarkdown(textParts.join("\n").trim())}</div>` };
  }

  if (msg.type === "system") {
    const text =
      typeof msg.message === "string"
        ? msg.message
        : typeof msg.message?.content === "string"
          ? msg.message.content
          : "";
    if (text && !text.startsWith("<")) {
      return { role: "system", html: `<details class="system-msg"><summary>System</summary><div class="msg-body">${renderMarkdown(text)}</div></details>` };
    }
  }

  return null;
}

interface UserNavItem {
  id: string;
  preview: string;
  index: number;
}

function processSession(
  messages: SessionMessage[],
  repoUrl: string,
  commitSha: string,
  author: string,
  label?: string
): { html: string; userNav: UserNavItem[] } {
  const toolResultMap = buildToolResultMap(messages);
  const output: string[] = [];
  const userNav: UserNavItem[] = [];

  if (label) {
    output.push(`<div class="subagent-label">${esc(label)}</div>`);
  }

  // Render all messages, then group consecutive same-role messages
  const rendered: { role: string; html: string; text: string }[] = [];
  for (const msg of messages) {
    const r = renderMessage(msg, toolResultMap, repoUrl, commitSha, author);
    if (r) {
      // Extract plain text preview for user messages
      let text = "";
      if (r.role === "user") {
        const content = msg.message?.content;
        if (typeof content === "string") {
          text = content.trim();
        } else if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === "text" && c.text?.trim()) {
              if (c.text.startsWith("<")) continue;
              text = c.text.trim();
              break;
            }
          }
        }
      }
      rendered.push({ ...r, text });
    }
  }

  // Group consecutive messages by role
  let i = 0;
  let userGroupIdx = 0;
  while (i < rendered.length) {
    const role = rendered[i].role;
    const groupItems: string[] = [];
    let groupText = "";
    while (i < rendered.length && rendered[i].role === role) {
      groupItems.push(rendered[i].html);
      // Skip interrupt markers and very short text for preview
      if (!groupText && rendered[i].text && !rendered[i].text.startsWith("[Request interrupted")) {
        groupText = rendered[i].text;
      }
      i++;
    }

    if (role === "user") {
      userGroupIdx++;
      const id = `user-msg-${userGroupIdx}`;
      const preview = groupText
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 60)
        .trim();
      if (preview) {
        userNav.push({ id, preview: preview + (groupText.length > 60 ? "..." : ""), index: userGroupIdx });
      }
      output.push(
        `<div id="${id}" class="msg-group user-group"><span class="avatar user-avatar">${esc(author[0].toUpperCase())}</span><div class="msg-group-content">${groupItems.join("\n")}</div></div>`
      );
    } else if (role === "assistant") {
      output.push(
        `<div class="msg-group assistant-group"><span class="avatar assistant-avatar">C</span><div class="msg-group-content">${groupItems.join("\n")}</div></div>`
      );
    } else {
      output.push(groupItems.join("\n"));
    }
  }

  return { html: output.join("\n"), userNav };
}

// ── Load session files ─────────────────────────────────────────────────────────

function loadSession(sessionPath: string): {
  main: SessionMessage[];
  subagents: Map<string, { lines: SessionMessage[]; desc: string }>;
} {
  const raw = readFileSync(sessionPath, "utf-8");
  const main: SessionMessage[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      main.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  const subagents = new Map<string, { lines: SessionMessage[]; desc: string }>();
  const sessionDir = sessionPath.replace(/\.jsonl$/, "");
  const subagentsDir = join(sessionDir, "subagents");

  if (existsSync(subagentsDir)) {
    for (const file of readdirSync(subagentsDir).sort()) {
      if (!file.endsWith(".jsonl")) continue;
      const saLines: SessionMessage[] = [];
      const saRaw = readFileSync(join(subagentsDir, file), "utf-8");
      for (const line of saRaw.split("\n")) {
        if (!line.trim()) continue;
        try {
          saLines.push(JSON.parse(line));
        } catch {
          // skip
        }
      }
      const agentId = file.replace(".jsonl", "");
      // Try to find a description
      let desc = agentId;
      for (const sl of saLines) {
        if (sl.type === "user" && sl.message?.content) {
          const c = sl.message.content;
          if (typeof c === "string" && !c.startsWith("<")) {
            desc = c.slice(0, 80);
            break;
          }
          if (Array.isArray(c)) {
            for (const b of c) {
              if (b.type === "text" && b.text && !b.text.startsWith("<")) {
                desc = b.text.slice(0, 80);
                break;
              }
            }
            if (desc !== agentId) break;
          }
        }
      }
      subagents.set(agentId, { lines: saLines, desc });
    }
  }

  return { main, subagents };
}

// ── Build HTML ─────────────────────────────────────────────────────────────────

function buildHtml(
  sessionPath: string,
  commitSha: string,
  author: string,
  repoUrl: string
): string {
  const { main, subagents } = loadSession(sessionPath);

  // Extract version
  let version = "";
  for (const msg of main) {
    if (msg.version) {
      version = msg.version;
      break;
    }
  }

  // Extract timestamp range
  let firstTs = "";
  let lastTs = "";
  for (const msg of main) {
    if (msg.timestamp) {
      if (!firstTs) firstTs = msg.timestamp;
      lastTs = msg.timestamp;
    }
  }

  const shortSha = commitSha.slice(0, 8);
  const commitUrl = repoUrl ? `${repoUrl}/commit/${commitSha}` : "";

  const { html: mainHtml, userNav } = processSession(main, repoUrl, commitSha, author);

  let subagentHtml = "";
  for (const [agentId, { lines, desc }] of subagents) {
    const { html: inner } = processSession(lines, repoUrl, commitSha, author, `Subagent: ${agentId}`);
    subagentHtml += `<details class="subagent-block"><summary class="subagent-summary"><span class="tool-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/></svg></span>Subagent: ${esc(desc)}</summary><div class="subagent-content">${inner}</div></details>`;
  }

  // Build sidebar nav
  const sidebarItems = userNav.map(
    (item) => `<a class="sidebar-item" href="#${item.id}" data-target="${item.id}"><span class="sidebar-idx">${item.index}.</span>${esc(item.preview)}</a>`
  ).join("\n");
  const sidebarHtml = userNav.length > 1
    ? `<nav class="sidebar" id="sidebar"><div class="sidebar-title">User Messages</div>${sidebarItems}</nav>`
    : "";

  const timeInfo = firstTs
    ? `<span class="meta-sep">·</span><time>${new Date(firstTs).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time>`
    : "";

  const commitLink = commitUrl
    ? `<a href="${esc(commitUrl)}" target="_blank" rel="noopener"><code>${esc(shortSha)}</code></a>`
    : `<code>${esc(shortSha)}</code>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Code Session — ${esc(shortSha)}</title>
<link rel="stylesheet" href="../../assets/style.css">
<link rel="stylesheet" href="../../assets/highlight-github-dark.min.css">
</head>
<body>
<header class="page-header">
  <div class="header-inner">
    <h1>Claude Code Session</h1>
    <div class="meta">
      ${commitLink}${timeInfo}${version ? `<span class="meta-sep">·</span><span>Claude Code v${esc(version)}</span>` : ""}
    </div>
    <div class="header-actions">
      <button id="expand-all" class="btn btn-sm" title="Expand/Collapse All">Expand All</button>
    </div>
  </div>
</header>
${sidebarHtml}
<main>
${mainHtml}
${subagentHtml}
</main>
<script src="../../assets/highlight.min.js"></script>
<script src="../../assets/session.js"></script>
</body>
</html>`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

const { sessionPath, commitSha, author, repoUrl } = parseArgs();
process.stdout.write(buildHtml(sessionPath, commitSha, author, repoUrl));
