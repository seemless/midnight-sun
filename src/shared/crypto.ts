// ============================================================
// Crypto — thin wrapper around Web Crypto API
// Available in content scripts, popup, and background.
// ============================================================

/**
 * SHA-256 hash of a string, returned as a hex string.
 */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
