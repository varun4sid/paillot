// Unit tests for the JS Paillier client.  Run:  npm run test:crypto
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modPow, gcd, modInverse, randomBelow, encrypt, decrypt, encodeVote,
  decodeTally, formatBuckets, verifyIntegrity, encryptVoteClientSide,
} from "../src/crypto/paillierClient.js";

// Tiny fixed keypair (p = 1789, q = 1867) for fast deterministic math checks.
const p = 1789n, q = 1867n;
const n = p * q;
const lam = ((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n);
const g = n + 1n;
const mu = modInverse((modPow(g, lam, n * n) - 1n) / n, n);
const pub = { n: n.toString(), g: g.toString() };
const priv = { n: n.toString(), lambda: lam.toString(), mu: mu.toString() };

test("modPow", () => {
  assert.equal(modPow(4n, 13n, 497n), 445n);
  assert.equal(modPow(2n, 0n, 7n), 1n);
});

test("gcd / modInverse", () => {
  assert.equal(gcd(48n, 18n), 6n);
  assert.equal(modInverse(3n, 11n), 4n);
  assert.throws(() => modInverse(6n, 9n));
});

test("randomBelow stays in range", () => {
  for (let i = 0; i < 2000; i++) {
    const x = randomBelow(10n);
    assert.ok(x >= 0n && x < 10n);
  }
});

test("encrypt / decrypt round-trip and probabilistic", () => {
  for (const m of [0n, 1n, 1000n, 123456n]) {
    assert.equal(decrypt(priv, encrypt(pub, m).c), m);
  }
  const a = encrypt(pub, 1000n).c, b = encrypt(pub, 1000n).c;
  assert.notEqual(a, b);
});

test("homomorphic addition", () => {
  const nSq = n * n;
  const c = (encrypt(pub, 1000n).c * encrypt(pub, 1n).c * encrypt(pub, 1n).c) % nSq;
  assert.equal(decrypt(priv, c), 1002n);
});

test("Base-1000 encode / decode / format", () => {
  assert.equal(encodeVote(2), 1000000n);
  assert.deepEqual(decodeTally(8005012n, 3), [12, 5, 8]);
  assert.equal(formatBuckets(8005012n, 3), "008 | 005 | 012");
});

test("integrity check", () => {
  assert.equal(verifyIntegrity(8005012n, 3, 25).verified, true);
  assert.equal(verifyIntegrity(8005012n, 3, 24).verified, false);   // count mismatch
  assert.equal(verifyIntegrity(5008005012n, 3, 25).inRange, false); // overflow digits
  // A cheater encrypting 5 * 1000^0 instead of a valid 1000^i:
  assert.equal(verifyIntegrity(8005016n, 3, 25).verified, false);
});

test("encryptVoteClientSide returns API-ready strings", () => {
  const v = encryptVoteClientSide(pub, 1);
  assert.equal(typeof v.ciphertext, "string");
  assert.equal(decrypt(priv, v.ciphertext), 1000n);
  assert.ok(v.encryptionTimeMs >= 0 && v.expansionRatio > 0);
});
