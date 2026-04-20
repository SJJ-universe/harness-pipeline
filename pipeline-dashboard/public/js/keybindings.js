// Slice H (v5) — Keyboard shortcut router with 2-key-sequence support.
//
// UMD module. Two layers (same convention as toast.js / focus-trap.js):
//   1. `createDispatcher()` — pure keybinding state. Tests drive handleKey()
//      directly without a DOM.
//   2. `install({ doc })` — attaches a document-level keydown listener that
//      forwards to the dispatcher. Idempotent — second install() returns the
//      first dispatcher instance.
//
// Sequence semantics:
//   - `"g t"` means "press g, then t within 1000ms".
//   - A sequence is aborted (buffer cleared) if the user presses an unknown
//     key or the timeout expires.
//   - Single-key bindings (e.g. `"?"`, `"Escape"`) have priority over
//     sequences — they fire immediately.
//   - While focus is inside `<input>` / `<textarea>` / contenteditable, keys
//     are passed through so the user can still type into forms.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessKeybindings = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SEQUENCE_TIMEOUT_MS = 1000;

  function _isModifier(k) {
    return k === "Shift" || k === "Control" || k === "Alt" || k === "Meta";
  }

  function _isTextField(el) {
    if (!el || typeof el !== "object") return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    if (el.isContentEditable === true) return true;
    return false;
  }

  function createDispatcher({ now = () => Date.now(), timeoutMs = SEQUENCE_TIMEOUT_MS } = {}) {
    const bindings = new Map();
    let buffer = "";
    let bufferAt = 0;

    function register(map) {
      for (const [key, fn] of Object.entries(map || {})) {
        if (typeof fn !== "function" || !key) continue;
        bindings.set(key, fn);
      }
    }

    function unregister(key) {
      bindings.delete(key);
    }

    function _resetBuffer() {
      buffer = "";
      bufferAt = 0;
    }

    function _expireBufferIfStale() {
      if (buffer && now() - bufferAt > timeoutMs) _resetBuffer();
    }

    function _hasPrefix(k) {
      for (const key of bindings.keys()) {
        if (key.length > 1 && key.startsWith(`${k} `)) return true;
      }
      return false;
    }

    function handleKey(event) {
      if (!event) return false;
      if (_isTextField(event.target)) return false;
      const k = event.key;
      if (!k || _isModifier(k)) return false;

      _expireBufferIfStale();

      // 2-key sequence completes? Check before single-key priority to allow
      // "g t" when g alone has no binding.
      if (buffer) {
        const seq = `${buffer} ${k}`;
        if (bindings.has(seq)) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          _resetBuffer();
          bindings.get(seq)(event);
          return true;
        }
        // Sequence didn't complete — fall through so we also try single-key.
        _resetBuffer();
      }

      // Single-key binding
      if (bindings.has(k)) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        bindings.get(k)(event);
        return true;
      }

      // First key of a known sequence?
      if (_hasPrefix(k)) {
        buffer = k;
        bufferAt = now();
        return true;
      }

      return false;
    }

    return {
      register,
      unregister,
      handleKey,
      _getBuffer: () => buffer,
      _size: () => bindings.size,
      _resetBuffer,
    };
  }

  let _installed = null;

  function install({ doc } = {}) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    if (!d) return null;
    if (_installed) return _installed;
    const dispatcher = createDispatcher();
    d.addEventListener("keydown", (e) => {
      dispatcher.handleKey(e);
    });
    _installed = dispatcher;
    return dispatcher;
  }

  function register(map) {
    if (!_installed) install();
    if (_installed) _installed.register(map);
  }

  function unregister(key) {
    if (_installed) _installed.unregister(key);
  }

  // Exposed for tests that want to start fresh without a full reload.
  function _resetForTests() {
    _installed = null;
  }

  return {
    install,
    register,
    unregister,
    createDispatcher,
    SEQUENCE_TIMEOUT_MS,
    _resetForTests,
  };
});
