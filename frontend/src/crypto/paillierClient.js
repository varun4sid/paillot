/**
 * From-scratch Paillier client (encryption for voters, decryption for the poll
 * creator) using only native JS BigInt and window.crypto.getRandomValues.
 * No third-party crypto / homomorphic-encryption libraries.
 *
 * All big integers travel as base-10 strings (matching the TEXT DB columns).
 */

export const BASE_M = 1000;
export const MAX_VOTES = 999;
export const MAX_CANDIDATES = 10;

// ---------------------------------------------------------------------------
// BigInt number-theory helpers
// ---------------------------------------------------------------------------

export function toBig(x) {
  return typeof x === "bigint" ? x : BigInt(x);
}

/** Right-to-left square-and-multiply modular exponentiation. */
export function modPow(base, exp, mod) {
  if (mod === 1n) return 0n;
  let result = 1n;
  base %= mod;
  if (base < 0n) base += mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

/** Iterative Euclidean algorithm. */
export function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Iterative Extended Euclidean Algorithm: x with a*x ≡ 1 (mod m). */
export function modInverse(a, m) {
  a %= m;
  if (a < 0n) a += m;
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];
  while (r) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("No modular inverse");
  return ((oldS % m) + m) % m;
}

export function bitLength(x) {
  return x === 0n ? 0 : x.toString(2).length;
}

/** Uniform random BigInt in [0, max) via rejection sampling on getRandomValues. */
export function randomBelow(max) {
  const bits = bitLength(max - 1n) || 1;
  const bytes = Math.ceil(bits / 8);
  const excess = BigInt(bytes * 8 - bits);
  const buf = new Uint8Array(bytes);
  while (true) {
    crypto.getRandomValues(buf);
    let x = 0n;
    for (const b of buf) x = (x << 8n) | BigInt(b);
    x >>= excess; // drop surplus high bits
    if (x < max) return x;
  }
}

/** L(x) = (x - 1) / n */
export function L(x, n) {
  return (x - 1n) / n;
}

// ---------------------------------------------------------------------------
// Base-M encoding
// ---------------------------------------------------------------------------

/** m = M^i */
export function encodeVote(candidateIndex, baseM = BASE_M) {
  return toBig(baseM) ** BigInt(candidateIndex);
}

/** count[i] = floor(M_total / M^i) mod M */
export function decodeTally(mTotal, numCandidates, baseM = BASE_M) {
  const M = toBig(baseM);
  mTotal = toBig(mTotal);
  const counts = [];
  for (let i = 0; i < numCandidates; i++) {
    counts.push(Number((mTotal / M ** BigInt(i)) % M));
  }
  return counts;
}

/** Split M_total into zero-padded base-M digit groups, e.g. "008 | 005 | 012". */
export function formatBuckets(mTotal, numCandidates, baseM = BASE_M) {
  const width = String(baseM - 1).length;
  return decodeTally(mTotal, numCandidates, baseM)
    .map((v) => String(v).padStart(width, "0"))
    .reverse()
    .join(" | ");
}

// ---------------------------------------------------------------------------
// Paillier primitives
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext m under public key {n, g}.
 *   c = (g^m mod n^2) * (r^n mod n^2) mod n^2,  r ∈ [1, n-1], gcd(r, n) = 1
 * Returns { c, r } as BigInts (r exposed only for the educational preview).
 */
export function encrypt(publicKey, m) {
  const n = toBig(publicKey.n);
  const g = toBig(publicKey.g);
  m = toBig(m);
  if (m < 0n || m >= n) throw new Error("Plaintext out of range");
  const nSq = n * n;

  let r;
  do {
    r = randomBelow(n - 1n) + 1n;
  } while (gcd(r, n) !== 1n);

  const c = (modPow(g, m, nSq) * modPow(r, n, nSq)) % nSq;
  return { c, r };
}

/**
 * Encode candidate i as M^i and encrypt it, timing the operation.
 * Returns strings ready for the API plus metrics.
 */
export function encryptVoteClientSide(publicKey, candidateIndex, baseM = BASE_M) {
  const m = encodeVote(candidateIndex, baseM);
  const t0 = performance.now();
  const { c, r } = encrypt(publicKey, m);
  const encryptionTimeMs = performance.now() - t0;
  return {
    ciphertext: c.toString(),
    r: r.toString(),
    plaintext: m.toString(),
    encryptionTimeMs,
    expansionRatio: expansionRatio(c),
  };
}

/** m = L(c^λ mod n^2) * μ mod n */
export function decrypt(privateKey, c) {
  const n = toBig(privateKey.n);
  const lam = toBig(privateKey.lambda);
  const mu = toBig(privateKey.mu);
  const nSq = n * n;
  return (L(modPow(toBig(c), lam, nSq), n) * mu) % n;
}

/** Decrypt with timing, as used on the projector view. */
export function decryptTally(privateKey, cTotal) {
  const t0 = performance.now();
  const mTotal = decrypt(privateKey, cTotal);
  return { mTotal, decryptionTimeMs: performance.now() - t0 };
}

/** Ciphertext bytes / plaintext bytes (plaintext treated as an 8-byte integer). */
export function expansionRatio(c, plaintextBytes = 8) {
  return Math.ceil(bitLength(toBig(c)) / 8) / plaintextBytes;
}

// ---------------------------------------------------------------------------
// Post-decryption integrity check (tamper detection without NIZK)
// ---------------------------------------------------------------------------

export function verifyIntegrity(mTotal, numCandidates, totalVotesCast, baseM = BASE_M) {
  mTotal = toBig(mTotal);
  const counts = decodeTally(mTotal, numCandidates, baseM);
  const decodedSum = counts.reduce((a, b) => a + b, 0);
  const upperBound = toBig(baseM) ** BigInt(numCandidates);
  const inRange = mTotal < upperBound;
  return {
    counts,
    decodedSum,
    inRange,
    leftover: (mTotal / upperBound).toString(), // high-order digits beyond k buckets
    verified: inRange && decodedSum === Number(totalVotesCast),
  };
}
