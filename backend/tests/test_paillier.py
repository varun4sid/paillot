"""Unit tests for the from-scratch Paillier module.  Run:  python -m unittest -v"""

import unittest

from app.paillier_scratch import (
    L, decode_tally, decrypt, encode_vote, encrypt, gcd, generate_paillier_keypair,
    generate_prime, homomorphic_tally, is_probable_prime, lcm, mod_inverse,
)


class NumberTheoryTests(unittest.TestCase):
    def test_gcd_lcm(self):
        self.assertEqual(gcd(48, 18), 6)
        self.assertEqual(gcd(17, 5), 1)
        self.assertEqual(lcm(4, 6), 12)

    def test_mod_inverse(self):
        self.assertEqual(mod_inverse(3, 11), 4)
        for a, m in [(17, 3120), (12345, 2**61 - 1)]:
            self.assertEqual(a * mod_inverse(a, m) % m, 1)
        with self.assertRaises(ValueError):
            mod_inverse(6, 9)

    def test_miller_rabin(self):
        primes = [2, 3, 5, 97, 7919, 2**61 - 1, 2**127 - 1]
        composites = [1, 4, 561, 1105, 7917, 2**61 + 1, (2**61 - 1) * (2**31 - 1)]
        for p in primes:
            self.assertTrue(is_probable_prime(p), p)
        for c in composites:
            self.assertFalse(is_probable_prime(c), c)

    def test_generate_prime_bit_length(self):
        p = generate_prime(256)
        self.assertEqual(p.bit_length(), 256)
        self.assertTrue(is_probable_prime(p))

    def test_L(self):
        self.assertEqual(L(1 + 5 * 7, 7), 5)


class PaillierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pub, cls.priv = generate_paillier_keypair(512)

    def test_key_shape(self):
        n = self.pub["n"]
        self.assertEqual(n.bit_length(), 512)
        self.assertEqual(self.pub["g"], n + 1)
        self.assertEqual(self.priv["n"], n)

    def test_encrypt_decrypt_roundtrip(self):
        for m in [0, 1, 42, 1000**9, self.pub["n"] - 1]:
            self.assertEqual(decrypt(self.priv, encrypt(self.pub, m)), m)

    def test_probabilistic(self):
        c1, c2 = encrypt(self.pub, 1000), encrypt(self.pub, 1000)
        self.assertNotEqual(c1, c2)
        self.assertEqual(decrypt(self.priv, c1), decrypt(self.priv, c2))

    def test_homomorphic_addition(self):
        a, b = 123456, 987654
        c = homomorphic_tally([encrypt(self.pub, a), encrypt(self.pub, b)], self.pub["n"])
        self.assertEqual(decrypt(self.priv, c), a + b)

    def test_base_m_election(self):
        votes = [0] * 12 + [1] * 5 + [2] * 8 + [9] * 3      # 4 candidates used of 10
        cts = [encrypt(self.pub, encode_vote(i)) for i in votes]
        m_total = decrypt(self.priv, homomorphic_tally(cts, self.pub["n"]))
        counts = decode_tally(m_total, 10)
        self.assertEqual(counts, [12, 5, 8, 0, 0, 0, 0, 0, 0, 3])

    def test_max_capacity(self):
        # 999 votes in the highest bucket must not overflow.
        m_total = decrypt(self.priv, encrypt(self.pub, 999 * encode_vote(9)))
        self.assertEqual(decode_tally(m_total, 10)[9], 999)


if __name__ == "__main__":
    unittest.main()
