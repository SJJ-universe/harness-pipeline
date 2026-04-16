(function () {
  function text(value) {
    return document.createTextNode(String(value == null ? "" : value));
  }

  function el(tagName, attrs, children) {
    const node = document.createElement(tagName);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "class") node.className = value;
      else if (key === "dataset") {
        for (const [dataKey, dataValue] of Object.entries(value || {})) {
          node.dataset[dataKey] = String(dataValue);
        }
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value !== false && value != null) {
        node.setAttribute(key, String(value));
      }
    }
    for (const child of [].concat(children || [])) {
      node.appendChild(child instanceof Node ? child : text(child));
    }
    return node;
  }

  function safeHtmlFromTemplate(strings, ...values) {
    return strings.reduce((out, part, index) => {
      const value = index < values.length
        ? String(values[index]).replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[ch])
        : "";
      return out + part + value;
    }, "");
  }

  window.HarnessDom = { el, safeHtmlFromTemplate, text };
})();
