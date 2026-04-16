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
        .catch(() => "");
    }
    return tokenPromise;
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
    return originalFetch(input, options);
  };
})();
