/* Claude Code Session Viewer — client-side renderer + interactivity */

(function () {
  "use strict";

  // ── URL parsing ─────────────────────────────────────────────────────────────

  var params = new URLSearchParams(window.location.search);
  var prNum = params.get("pr");
  var sha = params.get("sha");
  var repoUrl = params.get("repo") || "";
  if (repoUrl) repoUrl = repoUrl.replace(/\/$/, "");

  // ── DOM refs ────────────────────────────────────────────────────────────────

  var loadingEl = document.getElementById("loading");
  var errorEl = document.getElementById("error");
  var mainEl = document.getElementById("main");
  var metaEl = document.getElementById("meta");
  var sidebarEl = document.getElementById("sidebar");
  var headerActionsEl = document.getElementById("header-actions");
  var titleEl = document.querySelector(".page-header h1");

  // ── Claude logo SVG (sunburst) ──────────────────────────────────────────────

  var CLAUDE_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#D97706">' +
    '<path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>' +
    '</svg>';

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function esc(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var EXT_TO_LANG = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
    ".py": "python", ".rs": "rust", ".go": "go", ".rb": "ruby", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".cs": "csharp",
    ".swift": "swift", ".kt": "kotlin", ".sh": "bash", ".bash": "bash",
    ".zsh": "bash", ".fish": "bash", ".yml": "yaml", ".yaml": "yaml",
    ".json": "json", ".toml": "toml", ".xml": "xml", ".html": "html",
    ".css": "css", ".scss": "scss", ".sql": "sql", ".md": "markdown",
    ".dockerfile": "dockerfile", ".tf": "hcl", ".lua": "lua", ".r": "r",
    ".svelte": "html", ".vue": "html",
  };

  function extname(fp) {
    var m = fp.match(/\.[^/.]+$/);
    return m ? m[0] : "";
  }

  function basename(fp) {
    return fp.split("/").pop() || fp;
  }

  function langFromPath(filePath) {
    var ext = extname(filePath).toLowerCase();
    if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
    var base = basename(filePath).toLowerCase();
    if (base === "dockerfile") return "dockerfile";
    if (base === "makefile") return "makefile";
    if (base === "justfile") return "makefile";
    if (base.endsWith(".env")) return "bash";
    return "";
  }

  function fileLink(filePath, commitSha) {
    if (!repoUrl) return '<span class="file-path">' + esc(filePath) + "</span>";
    var rel = filePath;
    var repoName = repoUrl.split("/").pop() || "";
    var idx = rel.indexOf("/" + repoName + "/");
    if (idx !== -1) {
      rel = rel.slice(idx + repoName.length + 2);
    }
    var url = repoUrl + "/blob/" + commitSha + "/" + rel;
    return '<a class="file-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(filePath) + "</a>";
  }

  function shortPath(filePath) {
    var parts = filePath.split("/");
    if (parts.length <= 3) return filePath;
    return parts.slice(0, 1).join("/") + "/.../" + parts.slice(-2).join("/");
  }

  // ── Markdown rendering (marked.js) ──────────────────────────────────────────

  if (typeof marked !== "undefined") {
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: function (code, lang) {
        if (typeof hljs !== "undefined") {
          if (lang && hljs.getLanguage(lang)) {
            try { return hljs.highlight(code, { language: lang }).value; } catch (e) {}
          }
          try { return hljs.highlightAuto(code).value; } catch (e) {}
        }
        return code;
      },
    });
  }

  function renderMarkdown(text) {
    if (typeof marked !== "undefined") {
      try { return marked.parse(text); } catch (e) {}
    }
    // Fallback: basic escaping with code blocks
    var escaped = esc(text);
    escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var cls = lang ? ' class="language-' + lang + '"' : "";
      return "<pre><code" + cls + ">" + code + "</code></pre>";
    });
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    var parts = escaped.split(/(<pre>[\s\S]*?<\/pre>)/);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i].startsWith("<pre>")) {
        parts[i] = parts[i].replace(/\n/g, "<br>\n");
      }
    }
    return parts.join("");
  }

  // ── Diff rendering ──────────────────────────────────────────────────────────

  function renderDiff(oldStr, newStr, filePath, lang) {
    if (typeof Diff === "undefined") {
      return '<pre><code class="language-diff">' + esc(newStr) + "</code></pre>";
    }
    var patch = Diff.createTwoFilesPatch(filePath, filePath, oldStr, newStr, "", "");
    var lines = patch.split("\n");
    var startIdx = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("@@")) { startIdx = i; break; }
    }
    var out = [];
    var oldLine = 0, newLine = 0;
    for (var i = startIdx; i < lines.length; i++) {
      var line = lines[i];
      if (line.startsWith("@@")) {
        var match = line.match(/@@ -(\d+)/);
        if (match) { oldLine = parseInt(match[1], 10) - 1; newLine = oldLine; }
        var matchNew = line.match(/\+(\d+)/);
        if (matchNew) newLine = parseInt(matchNew[1], 10) - 1;
        out.push('<tr class="diff-hunk"><td class="diff-ln"></td><td class="diff-ln"></td><td class="diff-marker"></td><td>' + esc(line) + "</td></tr>");
      } else if (line.startsWith("+")) {
        newLine++;
        out.push('<tr class="diff-add"><td class="diff-ln"></td><td class="diff-ln">' + newLine + '</td><td class="diff-marker">+</td><td>' + esc(line.slice(1)) + "</td></tr>");
      } else if (line.startsWith("-")) {
        oldLine++;
        out.push('<tr class="diff-del"><td class="diff-ln">' + oldLine + '</td><td class="diff-ln"></td><td class="diff-marker">-</td><td>' + esc(line.slice(1)) + "</td></tr>");
      } else if (line.startsWith("\\")) {
        continue;
      } else {
        oldLine++; newLine++;
        out.push('<tr class="diff-ctx"><td class="diff-ln">' + oldLine + '</td><td class="diff-ln">' + newLine + '</td><td class="diff-marker"> </td><td>' + esc(line.slice(1) || "") + "</td></tr>");
      }
    }
    var langAttr = lang ? ' data-lang="' + lang + '"' : "";
    return '<table class="diff-table"' + langAttr + ">" + out.join("\n") + "</table>";
  }

  // ── Tool icons (inline SVG) ─────────────────────────────────────────────────

  var TOOL_ICONS = {
    Bash: "terminal", Read: "file", Edit: "edit", Write: "file-plus",
    Grep: "search", Glob: "search", Task: "cpu", WebFetch: "globe",
    WebSearch: "globe", EnterPlanMode: "map", AskUserQuestion: "help-circle",
  };

  var SVGS = {
    terminal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    "file-plus": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    cpu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    globe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    map: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    "help-circle": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    tool: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  };

  function toolIcon(name) {
    var icon = TOOL_ICONS[name] || "tool";
    return SVGS[icon] || SVGS.tool;
  }

  // ── Extract tool result content ─────────────────────────────────────────────

  function extractResultContent(block) {
    var content = block.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter(function (c) { return typeof c === "object" && c.type === "text"; })
        .map(function (c) { return c.text || ""; })
        .join("\n");
    }
    return "";
  }

  // ── Build tool result map ───────────────────────────────────────────────────

  function buildToolResultMap(messages) {
    var map = {};
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.type !== "user") continue;
      var content = msg.message && msg.message.content;
      if (!Array.isArray(content)) continue;
      for (var j = 0; j < content.length; j++) {
        var block = content[j];
        if (block.type === "tool_result" && block.tool_use_id) {
          map[block.tool_use_id] = block;
        }
      }
    }
    return map;
  }

  // ── Render tool use ─────────────────────────────────────────────────────────

  function renderToolUse(block, result, commitSha, subagents, author) {
    var name = block.name || "Unknown";
    var inp = block.input || {};
    var icon = toolIcon(name);
    var summaryLabel = "";
    var detail = "";

    switch (name) {
      case "Bash": {
        var cmd = inp.command || "";
        var desc = inp.description || "";
        var cmdLines = cmd.split("\n");
        var firstActionLine = "";
        for (var i = 0; i < cmdLines.length; i++) {
          var trimmed = cmdLines[i].trim();
          if (trimmed && !trimmed.startsWith("#")) { firstActionLine = cmdLines[i]; break; }
        }
        if (!firstActionLine) firstActionLine = cmdLines[0] || "";
        var cmdPreview = firstActionLine.length > 80 ? firstActionLine.slice(0, 80) + "..." : firstActionLine;
        summaryLabel = desc
          ? '<span class="tool-cmd-preview">' + esc(cmdPreview) + '</span><span class="tool-desc">' + esc(desc) + "</span>"
          : '<span class="tool-cmd-preview">' + esc(cmdPreview) + "</span>";
        detail = '<pre><code class="language-bash">' + esc(cmd) + "</code></pre>";
        break;
      }
      case "Read": {
        var fp = inp.file_path || "";
        summaryLabel = shortPath(fp);
        detail = '<div class="tool-file-header">' + fileLink(fp, commitSha) + "</div>";
        break;
      }
      case "Edit": {
        var fp = inp.file_path || "";
        var oldStr = inp.old_string || "";
        var newStr = inp.new_string || "";
        var lang = langFromPath(fp);
        var addCount = newStr.split("\n").length;
        var delCount = oldStr.split("\n").length;
        var badge = '<span class="diff-badge"><span class="diff-badge-add">+' + addCount + '</span> <span class="diff-badge-del">-' + delCount + "</span></span>";
        summaryLabel = shortPath(fp) + " " + badge;
        detail = '<div class="tool-file-header">' + fileLink(fp, commitSha) + "</div>";
        if (oldStr || newStr) {
          detail += '<div class="diff-container">' + renderDiff(oldStr, newStr, fp, lang) + "</div>";
        }
        break;
      }
      case "Write": {
        var fp = inp.file_path || "";
        var content = inp.content || "";
        var lang = langFromPath(fp);
        var lineCount = content.split("\n").length;
        summaryLabel = shortPath(fp) + ' <span class="diff-badge"><span class="diff-badge-add">+' + lineCount + "</span></span>";
        detail = '<div class="tool-file-header">' + fileLink(fp, commitSha) + "</div>";
        var displayContent = content.length > 5000
          ? content.slice(0, 5000) + "\n... (" + content.length + " chars total)"
          : content;
        var cls = lang ? ' class="language-' + lang + '"' : "";
        detail += "<pre><code" + cls + ">" + esc(displayContent) + "</code></pre>";
        break;
      }
      case "Grep": {
        var pattern = inp.pattern || "";
        var path = inp.path || "";
        summaryLabel = '"' + esc(pattern) + '"' + (path ? " in " + shortPath(path) : "");
        break;
      }
      case "Glob": {
        summaryLabel = esc(inp.pattern || "");
        break;
      }
      case "Task": {
        summaryLabel = esc(inp.description || "Subagent task");
        // Try to find and inline the subagent session
        if (result && subagents) {
          var resultText = extractResultContent(result);
          var agentMatch = resultText.match(/agentId:\s*([a-z0-9]+)/);
          if (agentMatch) {
            var agentKey = "agent-" + agentMatch[1];
            var sa = subagents[agentKey];
            if (sa) {
              var inner = processSession(sa.lines, commitSha, author);
              detail = '<div class="subagent-inline">' + inner.html + '</div>';
            }
          }
        }
        break;
      }
      case "AskUserQuestion": {
        var questions = block.input && block.input.questions;
        if (questions && questions.length > 0) {
          var q = questions[0];
          summaryLabel = esc(q.question || "Question");
          var questionHtml = '<div class="ask-question">';
          questionHtml += '<div class="ask-question-text">' + esc(q.question || "") + "</div>";
          var options = q.options;
          if (options) {
            questionHtml += '<div class="ask-options">';
            for (var oi = 0; oi < options.length; oi++) {
              var opt = options[oi];
              questionHtml += '<div class="ask-option"><span class="ask-option-label">' + esc(opt.label || "") + "</span>";
              if (opt.description) {
                questionHtml += '<span class="ask-option-desc">' + esc(opt.description) + "</span>";
              }
              questionHtml += "</div>";
            }
            questionHtml += "</div>";
          }
          questionHtml += "</div>";
          detail = questionHtml;
        } else {
          summaryLabel = "Question";
          var inputStr = JSON.stringify(block.input || {}, null, 2);
          detail = '<pre><code class="language-json">' + esc(inputStr) + "</code></pre>";
        }
        break;
      }
      default: {
        summaryLabel = esc(name);
        var inputStr = JSON.stringify(block.input || {}, null, 2);
        if (inputStr !== "{}") {
          detail = '<pre><code class="language-json">' + esc(inputStr) + "</code></pre>";
        }
      }
    }

    // Render result
    var resultHtml = "";
    if (result) {
      var resultContent = extractResultContent(result);
      var isError = result.is_error || false;
      if (resultContent.trim()) {
        var errClass = isError ? " error" : "";
        var charCount = resultContent.length;
        var displayResult = resultContent.length > 8000
          ? resultContent.slice(0, 8000) + "\n... (" + resultContent.length + " chars total)"
          : resultContent;

        var resultCode = "";
        if (name === "Read" && inp.file_path) {
          var rlang = langFromPath(inp.file_path);
          var rcls = rlang ? ' class="language-' + rlang + '"' : "";
          resultCode = '<pre class="tool-result-content' + errClass + '"><code' + rcls + '>' + esc(displayResult) + "</code></pre>";
        } else {
          resultCode = '<pre class="tool-result-content' + errClass + '"><code>' + esc(displayResult) + "</code></pre>";
        }

        resultHtml = '<div class="tool-result-inline' + errClass + '"><div class="tool-result-header">' + (isError ? "Error" : "Output") + ' <span class="result-size">' + charCount.toLocaleString() + " chars</span></div>" + resultCode + "</div>";
      }
    }

    var openByDefault = name === "Edit" || name === "Write";
    return '<div class="tool-block">\n<details' + (openByDefault ? " open" : "") + '>\n<summary class="tool-summary"><span class="tool-icon">' + icon + '</span><span class="tool-name">' + esc(name) + '</span><span class="tool-label">' + summaryLabel + '</span></summary>\n<div class="tool-detail">' + detail + resultHtml + "</div>\n</details>\n</div>";
  }

  // ── Render thinking ─────────────────────────────────────────────────────────

  function renderThinking(text) {
    var display = text.length > 5000 ? text.slice(0, 5000) + "\n... (" + text.length + " chars)" : text;
    return '<details class="thinking-block"><summary class="thinking-summary"><span class="tool-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>Thinking <span class="result-size">' + text.length.toLocaleString() + " chars</span></summary>" + '<div class="thinking-content">' + renderMarkdown(display) + "</div></details>";
  }

  // ── Render a single message ─────────────────────────────────────────────────

  function renderMessage(msg, toolResultMap, commitSha, author, subagents) {
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
      var content = msg.message && msg.message.content;
      if (!content) return null;

      if (typeof content === "string") {
        if (!content.trim()) return null;
        return { role: "assistant", html: '<div class="msg-item">' + renderMarkdown(content.trim()) + "</div>" };
      }

      var parts = [];
      for (var i = 0; i < content.length; i++) {
        var c = content[i];
        if (c.type === "thinking" && c.thinking) {
          parts.push(renderThinking(c.thinking));
        } else if (c.type === "text" && c.text && c.text.trim()) {
          parts.push('<div class="msg-text">' + renderMarkdown(c.text.trim()) + "</div>");
        } else if (c.type === "tool_use") {
          var result = c.id ? toolResultMap[c.id] || null : null;
          parts.push(renderToolUse(c, result, commitSha, subagents, author));
        }
      }

      if (parts.length === 0) return null;
      return { role: "assistant", html: '<div class="msg-item">' + parts.join("\n") + "</div>" };
    }

    if (msg.type === "user") {
      var content = msg.message && msg.message.content;
      if (!content) return null;

      if (typeof content === "string") {
        if (content.startsWith("<") && !content.startsWith("<!")) return null;
        if (!content.trim()) return null;
        return { role: "user", html: '<div class="msg-item">' + renderMarkdown(content) + "</div>" };
      }

      var textParts = [];
      for (var i = 0; i < content.length; i++) {
        var c = content[i];
        if (c.type === "text" && c.text && c.text.trim()) {
          if (c.text.startsWith("<local-command") || c.text.startsWith("<command-")) continue;
          if (c.text.startsWith("<system-reminder")) continue;
          if (c.text.startsWith("<local-command-stdout")) continue;
          textParts.push(c.text);
        }
      }

      if (textParts.length === 0) return null;
      return { role: "user", html: '<div class="msg-item">' + renderMarkdown(textParts.join("\n").trim()) + "</div>" };
    }

    if (msg.type === "system") {
      var text = typeof msg.message === "string"
        ? msg.message
        : (msg.message && typeof msg.message.content === "string")
          ? msg.message.content
          : "";
      if (text && !text.startsWith("<")) {
        return { role: "system", html: '<details class="system-msg"><summary>System</summary><div class="msg-body">' + renderMarkdown(text) + "</div></details>" };
      }
    }

    return null;
  }

  // ── Process session (group messages) ────────────────────────────────────────

  function processSession(messages, commitSha, author, label, subagents) {
    var toolResultMap = buildToolResultMap(messages);
    var output = [];
    var userNav = [];

    if (label) {
      output.push('<div class="subagent-label">' + esc(label) + "</div>");
    }

    // Render all messages
    var rendered = [];
    for (var mi = 0; mi < messages.length; mi++) {
      var msg = messages[mi];
      var r;
      r = renderMessage(msg, toolResultMap, commitSha, author, subagents);
      if (r) {
        var text = "";
        if (r.role === "user") {
          var content = msg.message && msg.message.content;
          if (typeof content === "string") {
            text = content.trim();
          } else if (Array.isArray(content)) {
            for (var ci = 0; ci < content.length; ci++) {
              var c = content[ci];
              if (c.type === "text" && c.text && c.text.trim()) {
                if (c.text.startsWith("<")) continue;
                text = c.text.trim();
                break;
              }
            }
          }
        }
        rendered.push({ role: r.role, html: r.html, text: text });
      }
    }

    // Group consecutive messages by role
    var i = 0;
    var userGroupIdx = 0;
    while (i < rendered.length) {
      var role = rendered[i].role;
      var groupItems = [];
      var groupText = "";
      while (i < rendered.length && rendered[i].role === role) {
        groupItems.push(rendered[i].html);
        if (!groupText && rendered[i].text && !rendered[i].text.startsWith("[Request interrupted")) {
          groupText = rendered[i].text;
        }
        i++;
      }

      if (role === "user") {
        userGroupIdx++;
        var id = "user-msg-" + userGroupIdx;
        var preview = groupText
          .replace(/\n/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 60)
          .trim();
        if (preview) {
          userNav.push({ id: id, preview: preview + (groupText.length > 60 ? "..." : ""), index: userGroupIdx });
        }
        output.push('<div id="' + id + '" class="msg-group user-group"><img class="avatar user-avatar" src="https://github.com/' + encodeURIComponent(author) + '.png?size=48" alt="' + esc(author) + '"><div class="msg-group-content">' + groupItems.join("\n") + "</div></div>");
      } else if (role === "assistant") {
        output.push('<div class="msg-group assistant-group"><span class="avatar assistant-avatar">' + CLAUDE_LOGO_SVG + '</span><div class="msg-group-content">' + groupItems.join("\n") + "</div></div>");
      } else {
        output.push(groupItems.join("\n"));
      }
    }

    return { html: output.join("\n"), userNav: userNav };
  }

  // ── Parse bundled JSONL (split on ---SUBAGENT: markers) ─────────────────────

  function parseBundledJsonl(text) {
    // Split on ---SUBAGENT:id--- only when it appears on its own line
    // (not inside JSON strings where it may appear as content)
    var parts = text.split(/\n---SUBAGENT:/);
    var mainLines = parseJsonlLines(parts[0]);
    var subagents = {};

    for (var p = 1; p < parts.length; p++) {
      var chunk = parts[p];
      var nlIdx = chunk.indexOf("---\n");
      if (nlIdx === -1) continue;
      var agentId = chunk.slice(0, nlIdx).trim();
      // Validate agentId looks like a real ID (alphanumeric/hyphens/underscores, not prose)
      if (!agentId || agentId.length > 80 || /\s/.test(agentId)) continue;
      var agentContent = chunk.slice(nlIdx + 4);
      var saLines = parseJsonlLines(agentContent);

      // Extract description from first non-XML user message
      var desc = agentId;
      for (var si = 0; si < saLines.length; si++) {
        var sl = saLines[si];
        if (sl.type === "user" && sl.message && sl.message.content) {
          var c = sl.message.content;
          if (typeof c === "string" && !c.startsWith("<")) {
            desc = c.slice(0, 80);
            break;
          }
          if (Array.isArray(c)) {
            for (var bi = 0; bi < c.length; bi++) {
              if (c[bi].type === "text" && c[bi].text && !c[bi].text.startsWith("<")) {
                desc = c[bi].text.slice(0, 80);
                break;
              }
            }
            if (desc !== agentId) break;
          }
        }
      }
      subagents[agentId] = { lines: saLines, desc: desc };
    }

    return { main: mainLines, subagents: subagents };
  }

  function parseJsonlLines(text) {
    var lines = text.split("\n");
    var messages = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        messages.push(JSON.parse(line));
      } catch (e) {
        // skip malformed
      }
    }
    return messages;
  }

  // ── Session stats ───────────────────────────────────────────────────────────

  function computeStats(messages) {
    var stats = {
      model: "", apiCalls: 0,
      inputTokens: 0, cacheCreation: 0, cacheRead: 0, outputTokens: 0,
      peakContext: 0, contextWindow: 200000
    };

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.type === "assistant" && msg.message) {
        var m = msg.message;
        if (m.model && !stats.model) stats.model = m.model;
        if (m.usage) {
          stats.apiCalls++;
          var u = m.usage;
          stats.inputTokens += u.input_tokens || 0;
          stats.cacheCreation += u.cache_creation_input_tokens || 0;
          stats.cacheRead += u.cache_read_input_tokens || 0;
          stats.outputTokens += u.output_tokens || 0;
          var turnInput = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          if (turnInput > stats.peakContext) stats.peakContext = turnInput;
        }
      }
    }

    return stats;
  }

  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function renderStats(stats, duration) {
    var contextPct = stats.peakContext > 0 ? Math.round((stats.peakContext / stats.contextWindow) * 100) : 0;
    var contextClass = contextPct >= 80 ? " stat-warn" : "";

    var html = '<details class="session-stats-wrap"><summary class="session-stats-summary">Session Stats &mdash; ' + esc(stats.model) + ', ' + stats.apiCalls + ' calls, ' + contextPct + '% context</summary>';
    html += '<div class="session-stats">';
    html += '<div class="stat"><span class="stat-label">Model</span><span class="stat-value">' + esc(stats.model) + '</span></div>';
    html += '<div class="stat"><span class="stat-label">API Calls</span><span class="stat-value">' + stats.apiCalls + '</span></div>';
    html += '<div class="stat"><span class="stat-label">Output</span><span class="stat-value">' + fmtTokens(stats.outputTokens) + ' tokens</span></div>';
    html += '<div class="stat"><span class="stat-label">Input (total)</span><span class="stat-value">' + fmtTokens(stats.inputTokens + stats.cacheCreation + stats.cacheRead) + ' tokens</span></div>';
    html += '<div class="stat' + contextClass + '"><span class="stat-label">Peak Context</span><span class="stat-value"><span class="context-bar-wrap"><span class="context-bar" style="width:' + Math.min(contextPct, 100) + '%"></span></span>' + contextPct + '%</span></div>';

    if (duration) {
      html += '<div class="stat"><span class="stat-label">Duration</span><span class="stat-value">' + duration + '</span></div>';
    }

    html += '</div></details>';
    return html;
  }

  // ── Render a full session into the DOM ──────────────────────────────────────

  function renderSession(jsonlText, commitSha, commitAuthor) {
    var data = parseBundledJsonl(jsonlText);
    var main = data.main;
    var subagents = data.subagents;

    // Extract version
    var version = "";
    for (var i = 0; i < main.length; i++) {
      if (main[i].version) { version = main[i].version; break; }
    }

    // Author is passed in from index.json (trusted, written by CI)
    var author = commitAuthor || "User";

    // Extract timestamp range
    var firstTs = "", lastTs = "";
    for (var i = 0; i < main.length; i++) {
      if (main[i].timestamp) {
        if (!firstTs) firstTs = main[i].timestamp;
        lastTs = main[i].timestamp;
      }
    }

    // Build header meta
    var shortSha = commitSha.slice(0, 8);
    var commitUrl = repoUrl ? repoUrl + "/commit/" + commitSha : "";
    var commitLink = commitUrl
      ? '<a href="' + esc(commitUrl) + '" target="_blank" rel="noopener"><code>' + esc(shortSha) + "</code></a>"
      : "<code>" + esc(shortSha) + "</code>";

    var timeInfo = firstTs
      ? '<span class="meta-sep">&middot;</span><time>' + new Date(firstTs).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) + "</time>"
      : "";

    var versionInfo = version
      ? '<span class="meta-sep">&middot;</span><span>Claude Code v' + esc(version) + "</span>"
      : "";

    metaEl.innerHTML = commitLink + timeInfo + versionInfo;

    // Add expand/collapse button
    headerActionsEl.innerHTML = '<button id="expand-all" class="btn btn-sm" title="Expand/Collapse All">Expand All</button>';

    // Update page title
    titleEl.textContent = "Claude Code Session";
    document.title = "Claude Code Session \u2014 " + shortSha;

    // Compute session stats
    var stats = computeStats(main);
    var duration = "";
    if (firstTs && lastTs) {
      var ms = new Date(lastTs) - new Date(firstTs);
      var mins = Math.floor(ms / 60000);
      var hrs = Math.floor(mins / 60);
      mins = mins % 60;
      duration = hrs > 0 ? hrs + "h " + mins + "m" : mins + "m";
    }
    var statsHtml = renderStats(stats, duration);

    // Process main session (pass subagents so Task tool_use can render them inline)
    var result = processSession(main, commitSha, author, null, subagents);
    var mainHtml = result.html;
    var userNav = result.userNav;

    // Build sidebar nav
    if (userNav.length > 1) {
      var sidebarItems = "";
      for (var ni = 0; ni < userNav.length; ni++) {
        var item = userNav[ni];
        sidebarItems += '<a class="sidebar-item" href="#' + item.id + '" data-target="' + item.id + '"><span class="sidebar-idx">' + item.index + '.</span>' + esc(item.preview) + "</a>\n";
      }
      sidebarEl.innerHTML = '<div class="sidebar-title">User Messages</div>' + sidebarItems;
      sidebarEl.style.display = "";
    }

    // Insert content
    mainEl.innerHTML = statsHtml + mainHtml;
    mainEl.style.display = "";

    // Run post-render setup
    initInteractivity();
  }

  // ── PR index view (list sessions) ───────────────────────────────────────────

  function renderPrIndex(prNumber, sessions) {
    titleEl.textContent = "Claude Code Sessions \u2014 PR #" + prNumber;
    document.title = "Claude Code Sessions \u2014 PR #" + prNumber;
    metaEl.innerHTML = '<span>PR #' + esc(prNumber) + "</span>";
    headerActionsEl.innerHTML = "";

    var html = '<div class="pr-index">';
    html += "<h2>Sessions for PR #" + esc(prNumber) + "</h2>";

    if (sessions.length === 0) {
      html += '<p class="pr-index-empty">No sessions found.</p>';
    } else {
      html += '<div class="pr-index-list">';
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var shortSha = s.sha.slice(0, 8);
        var url = "?pr=" + encodeURIComponent(prNumber) + "&sha=" + encodeURIComponent(s.sha);
        if (repoUrl) url += "&repo=" + encodeURIComponent(repoUrl);
        html += '<a class="pr-index-item" href="' + esc(url) + '">';
        html += '<code class="pr-index-sha">' + esc(shortSha) + "</code>";
        if (s.author) html += '<span class="pr-index-author">' + esc(s.author) + "</span>";
        if (s.timestamp) html += '<time class="pr-index-time">' + new Date(s.timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) + "</time>";
        html += "</a>";
      }
      html += "</div>";
    }
    html += "</div>";

    mainEl.innerHTML = html;
    mainEl.style.display = "";
  }

  // ── Landing page (no params) ────────────────────────────────────────────────

  function renderLanding() {
    titleEl.textContent = "Claude Code Session Viewer";
    document.title = "Claude Code Session Viewer";
    metaEl.innerHTML = "";
    headerActionsEl.innerHTML = "";

    mainEl.innerHTML = '<div class="landing">' +
      "<h2>Session Viewer</h2>" +
      "<p>View Claude Code sessions by adding query parameters:</p>" +
      '<ul>' +
      "<li><code>?pr=1234</code> &mdash; List sessions for a PR</li>" +
      "<li><code>?pr=1234&amp;sha=abc123</code> &mdash; View a specific session</li>" +
      "</ul>" +
      "</div>";
    mainEl.style.display = "";
  }

  // ── Post-render interactivity ───────────────────────────────────────────────

  function initInteractivity() {
    // Syntax highlighting
    if (typeof hljs !== "undefined") {
      hljs.highlightAll();

      document.querySelectorAll(".diff-table[data-lang]").forEach(function (table) {
        var lang = table.getAttribute("data-lang");
        table.querySelectorAll("tr:not(.diff-hunk) td:last-child").forEach(function (td) {
          var text = td.textContent || "";
          if (!text.trim()) return;
          try {
            var result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
            td.innerHTML = result.value;
          } catch (e) {}
        });
      });
    }

    // Expand / Collapse All
    var expandBtn = document.getElementById("expand-all");
    if (expandBtn) {
      var expanded = false;
      expandBtn.addEventListener("click", function () {
        expanded = !expanded;
        document.querySelectorAll("details").forEach(function (d) {
          d.open = expanded;
        });
        expandBtn.textContent = expanded ? "Collapse All" : "Expand All";
      });
    }

    // Copy buttons on code blocks
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.textContent.length < 20) return;
      if (pre.querySelector("table")) return;
      pre.style.position = "relative";
      var btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        var text = code ? code.textContent : pre.textContent;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 2000);
        });
      });
      pre.appendChild(btn);
    });

    // Sidebar nav — highlight active user message on scroll
    var sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.style.display !== "none") {
      var sidebarLinks = Array.from(sidebar.querySelectorAll(".sidebar-item"));
      var userGroups = sidebarLinks.map(function (link) {
        return document.getElementById(link.getAttribute("data-target"));
      }).filter(Boolean);

      var currentActive = null;
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              var id = entry.target.id;
              if (currentActive) currentActive.classList.remove("active");
              var link = sidebar.querySelector('[data-target="' + id + '"]');
              if (link) {
                link.classList.add("active");
                currentActive = link;
                link.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }
            }
          });
        },
        { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
      );
      userGroups.forEach(function (group) { observer.observe(group); });

      sidebarLinks.forEach(function (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          var target = document.getElementById(link.getAttribute("data-target"));
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }

    // Keyboard navigation
    var groups = Array.from(document.querySelectorAll(".msg-group"));
    var currentIdx = -1;
    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        if (e.key === "j") {
          currentIdx = Math.min(currentIdx + 1, groups.length - 1);
        } else {
          currentIdx = Math.max(currentIdx - 1, 0);
        }
        if (groups[currentIdx]) {
          groups[currentIdx].scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  }

  // ── Show/hide helpers ───────────────────────────────────────────────────────

  function showLoading(msg) {
    loadingEl.style.display = "";
    loadingEl.querySelector(".loading-text").textContent = msg || "Loading...";
    errorEl.style.display = "none";
    mainEl.style.display = "none";
  }

  function showError(msg) {
    loadingEl.style.display = "none";
    errorEl.style.display = "";
    errorEl.innerHTML = '<div class="error-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="error-message">' + esc(msg) + "</div>";
  }

  function hideLoading() {
    loadingEl.style.display = "none";
  }

  // ── Main entry point ────────────────────────────────────────────────────────

  function main() {
    if (!prNum) {
      hideLoading();
      renderLanding();
      return;
    }

    if (sha) {
      // Load session JSONL + index.json (for trusted author) in parallel
      showLoading("Loading session " + sha.slice(0, 8) + "...");
      var base = "data/pr/" + encodeURIComponent(prNum) + "/";
      var sessionUrl = base + encodeURIComponent(sha) + ".jsonl";
      var indexUrl = base + "index.json";
      Promise.all([
        fetch(sessionUrl).then(function (res) {
          if (!res.ok) throw new Error("Session not found (HTTP " + res.status + ")");
          return res.text();
        }),
        fetch(indexUrl).then(function (res) { return res.ok ? res.json() : []; }).catch(function () { return []; })
      ])
        .then(function (results) {
          var text = results[0];
          var manifest = results[1];
          var author = null;
          for (var i = 0; i < manifest.length; i++) {
            if (manifest[i].sha === sha) { author = manifest[i].author; break; }
          }
          hideLoading();
          renderSession(text, sha, author);
        })
        .catch(function (err) {
          showError(err.message || "Failed to load session");
        });
    } else {
      // Load PR session list
      showLoading("Loading sessions for PR #" + prNum + "...");
      var url = "data/pr/" + encodeURIComponent(prNum) + "/index.json";
      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error("PR sessions not found (HTTP " + res.status + ")");
          return res.json();
        })
        .then(function (sessions) {
          hideLoading();
          renderPrIndex(prNum, sessions);
        })
        .catch(function (err) {
          showError(err.message || "Failed to load session list");
        });
    }
  }

  main();
})();
