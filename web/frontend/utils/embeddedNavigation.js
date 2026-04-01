export function openTopLevelUrl(url) {
  if (!url || typeof window === "undefined") {
    return;
  }

  window.open(url, "_top", "noopener");
}

export function getEmbeddedAppUrl(path = "/") {
  if (typeof window === "undefined") {
    return path;
  }

  const url = new URL(path, window.location.origin);
  return `${url.pathname}${url.search}${url.hash}`;
}
