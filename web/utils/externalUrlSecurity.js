import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIp(address) {
  if (!address) {
    return true;
  }

  if (net.isIP(address) === 4) {
    return (
      address.startsWith("10.") ||
      address.startsWith("127.") ||
      address.startsWith("169.254.") ||
      address.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
    );
  }

  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return true;
}

export async function assertSafeExternalUrl(rawUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(String(rawUrl));
  } catch {
    throw new Error("Invalid external URL");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Unsafe external URL host");
  }

  const lookupResult = await dns.lookup(hostname, { all: true });
  if (!lookupResult.length || lookupResult.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Unsafe external URL destination");
  }

  return parsedUrl.toString();
}
