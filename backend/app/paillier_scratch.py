"""
From-scratch implementation of the Paillier cryptosystem (Pascal Paillier, 1999).

No third-party crypto / homomorphic-encryption libraries are used. Everything is
built on Python's native arbitrary-precision integers plus the `secrets` module
as a CSPRNG. The only built-in numeric helper relied on is the 3-argument
`pow(base, exp, mod)` for modular exponentiation, which is plain big-integer
arithmetic.

Roles in the voting system:
  * Backend  : prime generation, key generation, homomorphic tally.
  * Frontend : encryption (voters) and decryption (poll creator) in JS.
  * encrypt()/decrypt() are also provided here for testing & cross-checks.
"""

import secrets
import time

# Small primes used for fast trial division before Miller-Rabin.
_SMALL_PRIMES = [
    p for p in range(3, 2000)
    if all(p % d for d in range(2, int(p ** 0.5) + 1))
]


# ---------------------------------------------------------------------------
# Number-theory helpers
# ---------------------------------------------------------------------------

def gcd(a: int, b: int) -> int:
    """Iterative Euclidean algorithm."""
    a, b = abs(a), abs(b)
    while b:
        a, b = b, a % b
    return a


def lcm(a: int, b: int) -> int:
    return (a * b) // gcd(a, b)


def mod_inverse(a: int, m: int) -> int:
    """Iterative Extended Euclidean Algorithm: returns x with a*x ≡ 1 (mod m)."""
    a %= m
    old_r, r = a, m
    old_s, s = 1, 0
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
    if old_r != 1:
        raise ValueError(f"{a} has no inverse modulo {m}")
    return old_s % m


def is_probable_prime(n: int, k: int = 40) -> bool:
    """Miller-Rabin probabilistic primality test with k random bases."""
    if n < 2:
        return False
    if n in (2, 3):
        return True
    if n % 2 == 0:
        return False
    for p in _SMALL_PRIMES:
        if n == p:
            return True
        if n % p == 0:
            return False

    # Write n - 1 = 2^s * d with d odd.
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1

    for _ in range(k):
        a = secrets.randbelow(n - 3) + 2          # a in [2, n-2]
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False                          # composite witness found
    return True


def generate_prime(bits: int) -> int:
    """Random probable prime of exactly `bits` bits."""
    while True:
        # Force the top two bits so p*q has the full key size, and force odd.
        candidate = secrets.randbits(bits) | (0b11 << (bits - 2)) | 1
        if is_probable_prime(candidate):
            return candidate


def L(x: int, n: int) -> int:
    """Paillier's L function: L(x) = (x - 1) / n."""
    return (x - 1) // n


# ---------------------------------------------------------------------------
# Paillier primitives
# ---------------------------------------------------------------------------

def generate_paillier_keypair(key_bits: int = 1024):
    """
    Returns (public_key, private_key) as dicts of Python ints:
      public_key  = {"n", "g"}
      private_key = {"lambda", "mu", "n"}
    """
    if key_bits < 128 or key_bits % 2:
        raise ValueError("key_bits must be an even number >= 128")

    half = key_bits // 2
    while True:
        p = generate_prime(half)
        q = generate_prime(half)
        if p == q:
            continue
        n = p * q
        if gcd(n, (p - 1) * (q - 1)) == 1:
            break

    lam = lcm(p - 1, q - 1)
    g = n + 1                                     # standard simplification
    n_sq = n * n
    mu = mod_inverse(L(pow(g, lam, n_sq), n), n)

    return {"n": n, "g": g}, {"lambda": lam, "mu": mu, "n": n}


def random_r(n: int) -> int:
    """Random r in [1, n-1] with gcd(r, n) = 1."""
    while True:
        r = secrets.randbelow(n - 1) + 1
        if gcd(r, n) == 1:
            return r


def encrypt(public_key: dict, m: int, r: int | None = None) -> int:
    """c = g^m * r^n mod n^2  (mirrors the frontend JS implementation)."""
    n, g = public_key["n"], public_key["g"]
    if not 0 <= m < n:
        raise ValueError("plaintext out of range [0, n)")
    n_sq = n * n
    if r is None:
        r = random_r(n)
    return (pow(g, m, n_sq) * pow(r, n, n_sq)) % n_sq


def decrypt(private_key: dict, c: int) -> int:
    """m = L(c^lambda mod n^2) * mu mod n  (mirrors the frontend JS)."""
    n, lam, mu = private_key["n"], private_key["lambda"], private_key["mu"]
    n_sq = n * n
    return (L(pow(c, lam, n_sq), n) * mu) % n


def homomorphic_tally(ciphertexts: list[int], n: int) -> int:
    """C_total = prod(c_j) mod n^2  ==  Enc(sum of plaintexts)."""
    n_sq = n * n
    total = 1                                     # Enc(0) with r = 1
    for c in ciphertexts:
        total = (total * c) % n_sq
    return total


def benchmark_tally(ciphertexts: list[int], n: int, plaintext_count: int | None = None):
    """
    Returns (C_total, tally_time_ms, plaintext_time_ms).
    The plaintext baseline simply adds V ordinary integers, for comparison.
    """
    t0 = time.perf_counter()
    c_total = homomorphic_tally(ciphertexts, n)
    tally_ms = (time.perf_counter() - t0) * 1000

    v = len(ciphertexts) if plaintext_count is None else plaintext_count
    plain_values = [1] * v
    t0 = time.perf_counter()
    s = 0
    for x in plain_values:
        s += x
    plain_ms = (time.perf_counter() - t0) * 1000

    return c_total, tally_ms, plain_ms


# ---------------------------------------------------------------------------
# Base-M ballot encoding (shared logic with the frontend)
# ---------------------------------------------------------------------------

BASE_M = 1000
MAX_VOTES = 999
MAX_CANDIDATES = 10


def encode_vote(candidate_index: int, base_m: int = BASE_M) -> int:
    return base_m ** candidate_index


def decode_tally(m_total: int, num_candidates: int, base_m: int = BASE_M) -> list[int]:
    return [(m_total // base_m ** i) % base_m for i in range(num_candidates)]


def to_str_keys(d: dict) -> dict:
    """Serialize big ints as base-10 strings (DB / JSON transport format)."""
    return {k: str(v) for k, v in d.items()}
