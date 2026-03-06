/* Claude Code Session Viewer — interactive features */

(function () {
  "use strict";

  // ── Syntax highlighting ─────────────────────────────────────────────────
  if (typeof hljs !== "undefined") {
    hljs.highlightAll();
  }

  // ── Expand / Collapse All ───────────────────────────────────────────────
  const expandBtn = document.getElementById("expand-all");
  if (expandBtn) {
    let expanded = false;
    expandBtn.addEventListener("click", function () {
      expanded = !expanded;
      document.querySelectorAll("details").forEach(function (d) {
        d.open = expanded;
      });
      expandBtn.textContent = expanded ? "Collapse All" : "Expand All";
    });
  }

  // ── Copy buttons on code blocks ─────────────────────────────────────────
  document.querySelectorAll("pre").forEach(function (pre) {
    // Skip tiny blocks
    if (pre.textContent.length < 20) return;
    // Skip diff tables (they're in a table, not direct pre content)
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

  // ── Keyboard navigation ─────────────────────────────────────────────────
  var messages = Array.from(document.querySelectorAll(".msg"));
  var currentIdx = -1;

  document.addEventListener("keydown", function (e) {
    // Don't intercept if typing in an input
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "j" || e.key === "k") {
      e.preventDefault();
      if (e.key === "j") {
        currentIdx = Math.min(currentIdx + 1, messages.length - 1);
      } else {
        currentIdx = Math.max(currentIdx - 1, 0);
      }
      if (messages[currentIdx]) {
        messages[currentIdx].scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });
})();
