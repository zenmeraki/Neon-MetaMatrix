const TAWK_SRC = "https://embed.tawk.to/67599c5749e2fd8dfef661ef/1ier0ldkc";
const TAWK_IDLE_DELAY_MS = 8_000;

function scheduleIdle(callback, timeout = TAWK_IDLE_DELAY_MS) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout });
    return;
  }

  window.setTimeout(callback, timeout);
}

export function loadDeferredSupportChat() {
  if (
    import.meta.env.VITE_ENABLE_TAWK === "false" ||
    typeof window === "undefined" ||
    document.querySelector(`script[src="${TAWK_SRC}"]`)
  ) {
    return;
  }

  scheduleIdle(() => {
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();

    const script = document.createElement("script");
    script.async = true;
    script.src = TAWK_SRC;
    script.charset = "UTF-8";
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  });
}
