// Safe DOM rendering helpers — replace dynamic innerHTML with DOM API.
// All user/agent/hook data flows through textContent, never innerHTML.

window.HarnessRenderers = window.HarnessRenderers || {};

window.HarnessRenderers.safe = {
  /**
   * Create an element with optional classes and text content.
   */
  el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  },

  /**
   * Render a tool feed item as a DOM node.
   * @param {Object} entry - { ts, phase, tool, blocked, input, allowed, reason }
   */
  renderToolFeedItem(entry) {
    const div = this.el("div", `tool-entry${entry.blocked ? " tool-blocked" : ""}`);
    const time = this.el("span", "tool-time", new Date(entry.ts).toLocaleTimeString());
    const phase = this.el("span", "tool-phase", `[${entry.phase}]`);
    const tool = this.el("span", "tool-name", entry.tool);
    div.appendChild(time);
    div.appendChild(document.createTextNode(" "));
    div.appendChild(phase);
    div.appendChild(document.createTextNode(" "));
    div.appendChild(tool);
    if (entry.blocked) {
      const reason = this.el("span", "tool-reason", ` BLOCKED: ${entry.reason || ""}`);
      div.appendChild(reason);
    } else if (entry.input) {
      const input = this.el("span", "tool-input", ` ${entry.input}`);
      div.appendChild(input);
    }
    return div;
  },

  /**
   * Render a critique timeline item as a DOM node.
   * @param {Object} entry - { ts, phase, persona, severity, message }
   */
  renderCritiqueItem(entry) {
    const div = this.el("div", `critique-entry critique-${entry.severity || "medium"}`);
    const time = this.el("span", "critique-time", new Date(entry.ts).toLocaleTimeString());
    const badge = this.el("span", `critique-severity severity-${entry.severity || "medium"}`, `[${entry.severity || "?"}]`);
    const msg = this.el("span", "critique-message", ` ${entry.message || ""}`);
    div.appendChild(time);
    div.appendChild(document.createTextNode(" "));
    div.appendChild(badge);
    div.appendChild(msg);
    return div;
  },

  /**
   * Render a log entry as a DOM node.
   * @param {string} html - pre-sanitized log text (treat as text, not HTML)
   */
  renderLogEntry(text) {
    return this.el("div", "log-entry", text);
  },

  /**
   * Render trigger card metadata as a DOM node.
   * @param {Object} trigger - { name, description, contextSource }
   */
  renderTriggerMeta(trigger) {
    const div = this.el("div", "trigger-meta");
    div.appendChild(this.el("strong", null, trigger.name || ""));
    div.appendChild(this.el("p", null, trigger.description || ""));
    div.appendChild(this.el("small", null, `Context: ${trigger.contextSource || "?"}`));
    return div;
  },

  /**
   * Clear container and fill with items via a render function.
   * @param {HTMLElement} container
   * @param {Array} items
   * @param {Function} renderFn - (item) => HTMLElement
   */
  renderList(container, items, renderFn) {
    container.textContent = "";
    for (const item of items) {
      container.appendChild(renderFn(item));
    }
  },
};
