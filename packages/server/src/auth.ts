import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

// The bootable ISO ships a Node.js built without OpenSSL, where even
// loading node:crypto throws ERR_NO_CRYPTO — so it must never be imported
// at module load, only resolved lazily and with a pure-JS fallback.

type CryptoModule = typeof import("node:crypto");

const nodeRequire = createRequire(
  typeof __filename !== "undefined" ? __filename : process.cwd() + "/",
);

let cryptoMod: CryptoModule | null | undefined;

function loadCrypto(): CryptoModule | null {
  if (cryptoMod === undefined) {
    try {
      cryptoMod = nodeRequire("node:crypto") as CryptoModule;
    } catch {
      cryptoMod = null;
    }
  }
  return cryptoMod;
}

/** Pure-JS constant-time string comparison (crypto-free fallback). */
export function constantTimeEqual(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, "utf8");
  const b = Buffer.from(expected, "utf8");
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < a.length ? a[i] : 0) ^ (i < b.length ? b[i] : 0);
  }
  return diff === 0;
}

/** Timing-safe secret comparison; uses node:crypto when available. */
export function secretsMatch(offered: string, expected: string): boolean {
  const crypto = loadCrypto();
  if (crypto) {
    // Hash both sides so timingSafeEqual gets equal-length inputs.
    const a = crypto.createHash("sha256").update(offered).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  }
  return constantTimeEqual(offered, expected);
}
