/* Claude Code Session Viewer — interactive features */

(function () {
  "use strict";

  // ── Syntax highlighting ─────────────────────────────────────────────────
  if (typeof hljs !== "undefined") {
    hljs.highlightAll();

    // Highlight diff table cells that have a data-lang attribute
    document.querySelectorAll(".diff-table[data-lang]").forEach(function (table) {
      var lang = table.getAttribute("data-lang");
      table.querySelectorAll("tr:not(.diff-hunk) td:last-child").forEach(function (td) {
        var text = td.textContent || "";
        if (!text.trim()) return;
        try {
          var result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
          td.innerHTML = result.value;
        } catch (e) {
          // Language not available, skip
        }
      });
    });
  }

  // ── Expand / Collapse All ───────────────────────────────────────────────
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

  // ── Copy buttons on code blocks ─────────────────────────────────────────
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

  // ── Sidebar nav — highlight active user message on scroll ──────────────
  var sidebar = document.getElementById("sidebar");
  if (sidebar) {
    var sidebarLinks = Array.from(sidebar.querySelectorAll(".sidebar-item"));
    var userGroups = sidebarLinks.map(function (link) {
      return document.getElementById(link.getAttribute("data-target"));
    }).filter(Boolean);

    // Use IntersectionObserver to track which user group is visible
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
              // Scroll sidebar to keep active item visible
              link.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
          }
        });
      },
      {
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0
      }
    );

    userGroups.forEach(function (group) {
      observer.observe(group);
    });

    // Smooth scroll on sidebar click
    sidebarLinks.forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.getElementById(link.getAttribute("data-target"));
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────
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
})();
