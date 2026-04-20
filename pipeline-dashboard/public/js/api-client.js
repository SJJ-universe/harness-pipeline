// HarnessApi — shared HTTP plumbing for the dashboard frontend.
//
// Responsibilities:
//   1. Fetch the per-session harness auth token once (cached in window.HARNESS_TOKEN).
//   2. Attach `x-harness-token` to every state-changing /api/* request.
//   3. Slice C (v4): surface HTTP 500+ and network-level failures as toasts
//      with a "재시도" action, instead of failing silently. Same-message
//      toasts dedup via HarnessToast's counter so retry loops don't stack up.

(function () {
  const originalFetch = window.fetch.bind(window);
  let tokenPromise = null;

  async function getToken() {
    if (window.HARNESS_TOKEN) return window.HARNESS_TOKEN;
    if (!tokenPromise) {
      tokenPromise = originalFetch("/api/auth/token")
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          window.HARNESS_TOKEN = body && body.token ? body.token : "";
          return window.HARNESS_TOKEN;
        })
        .catch((err) => {
          // Slice C (v4): token fetch failures were previously swallowed
          // (`.catch(() => "")`). That leaves every subsequent state-changing
          // request attaching an empty token and getting 401 — the user had
          // no idea why. Surface it once via toast so the failure is visible.
          _showFailToast({
            message: "인증 토큰을 받지 못했습니다 — 재시도하세요.",
            actionLabel: "재시도",
            onAction: () => { tokenPromise = null; getToken(); },
          });
          window.HARNESS_TOKEN = "";
          return "";
        });
    }
    return tokenPromise;
  }

  // Slice C (v4): the toast system loads as a separate <script> so we can't
  // assume HarnessToast is ready the instant this IIFE runs. We late-resolve
  // per call and degrade to a console.warn if no toast surface is mounted
  // (e.g. in tests that load api-client directly).
  function _showFailToast(opts) {
    try {
      if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
        window.HarnessToast.show({
          type: opts.type || "error",
          message: opts.message,
          actionLabel: opts.actionLabel,
          onAction: opts.onAction,
        });
        return;
      }
    } catch (_) {}
    try { console.warn("[HarnessApi]", opts.message); } catch (_) {}
  }

  function _isApiUrl(url) {
    return typeof url === "string" && url.startsWith("/api/");
  }

  function _summarizeError(err) {
    if (!err) return "알 수 없는 네트워크 오류";
    if (err.name === "AbortError") return "요청이 취소되었습니다";
    return err.message || String(err);
  }

  window.HarnessApi = { getToken };
  getToken();

  window.fetch = async function harnessFetch(input, init) {
    const request = typeof input === "string" ? input : input && input.url;
    const url = request || "";
    const options = { ...(init || {}) };
    const method = String(options.method || "GET").toUpperCase();
    const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(method);

    if (url.startsWith("/api/") && url !== "/api/auth/token" && isStateChanging) {
      const token = await getToken();
      options.headers = new Headers(options.headers || {});
      options.headers.set("x-harness-token", token);
    }

    let res;
    try {
      res = await originalFetch(input, options);
    } catch (err) {
      // Only annotate our own endpoints — third-party CDN fetches shouldn't
      // produce "서버 오류" toasts. The ws reconnect toast covers live data.
      if (_isApiUrl(url)) {
        _showFailToast({
          message: `네트워크 오류: ${_summarizeError(err)}`,
          actionLabel: "재시도",
          onAction: () => { window.fetch(input, init).catch(() => {}); },
        });
      }
      throw err;
    }

    // 5xx and transport-level gateway errors get a toast. 4xx responses are
    // usually client-side validation (bad payload, missing field) and carry
    // their own response bodies — we let callers surface those contextually.
    if (_isApiUrl(url) && res && typeof res.status === "number" && res.status >= 500) {
      _showFailToast({
        message: `서버 오류 ${res.status} — ${url}`,
        actionLabel: "재시도",
        onAction: () => { window.fetch(input, init).catch(() => {}); },
      });
    }

    return res;
  };
})();
