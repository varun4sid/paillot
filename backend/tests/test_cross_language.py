"""
Cross-language verification:
  Python keygen  ->  JS encrypt (frontend module)  ->  Python homomorphic tally  ->  JS decrypt
Requires Node.js on PATH.  Run:  python -m unittest tests.test_cross_language -v
"""

import json
import random
import shutil
import subprocess
import unittest
from pathlib import Path

from app.paillier_scratch import (
    benchmark_tally, decrypt, generate_paillier_keypair, to_str_keys,
)

BRIDGE = Path(__file__).with_name("js_bridge.mjs")


def run_js(payload: dict):
    res = subprocess.run(["node", str(BRIDGE)], input=json.dumps(payload),
                         capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


@unittest.skipUnless(shutil.which("node"), "Node.js not installed")
class CrossLanguageTests(unittest.TestCase):
    def _election(self, key_bits: int, num_candidates: int, num_votes: int):
        pub, priv = generate_paillier_keypair(key_bits)
        votes = [random.randrange(num_candidates) for _ in range(num_votes)]
        expected = [votes.count(i) for i in range(num_candidates)]

        # 1. Voters encrypt in JS using the Python-generated public key.
        ballots = run_js({"op": "encrypt", "publicKey": to_str_keys(pub), "votes": votes})
        ciphertexts = [int(b["ciphertext"]) for b in ballots]
        self.assertEqual(len(set(ciphertexts)), num_votes)    # all ciphertexts distinct

        # 2. Server tallies homomorphically in Python.
        c_total, tally_ms, plain_ms = benchmark_tally(ciphertexts, pub["n"])

        # 3. Creator decrypts in JS.
        result = run_js({"op": "decrypt", "privateKey": to_str_keys(priv),
                         "cTotal": str(c_total), "numCandidates": num_candidates,
                         "totalVotes": num_votes})

        self.assertEqual(result["counts"], expected)
        self.assertTrue(result["integrity"]["verified"])
        self.assertEqual(int(result["mTotal"]), decrypt(priv, c_total))  # Py == JS

        avg_enc = sum(b["encryptionTimeMs"] for b in ballots) / num_votes
        print(f"\n  [{key_bits}-bit, {num_votes} votes, {num_candidates} candidates] "
              f"counts={result['counts']}  M_total={result['mTotal']}\n"
              f"  avg JS encrypt {avg_enc:.2f} ms | Py tally {tally_ms:.3f} ms "
              f"(plaintext {plain_ms:.4f} ms) | JS decrypt "
              f"{result['decryptionTimeMs']:.2f} ms | expansion "
              f"{ballots[0]['expansionRatio']:.0f}x")

    def test_512_bit(self):
        self._election(512, 3, 25)

    def test_1024_bit_ten_candidates(self):
        self._election(1024, 10, 60)

    def test_tampered_ballot_detected(self):
        pub, priv = generate_paillier_keypair(512)
        honest = run_js({"op": "encrypt", "publicKey": to_str_keys(pub), "votes": [0, 1, 1]})
        cts = [int(b["ciphertext"]) for b in honest]
        # Malicious voter encrypts 50 votes for candidate 0 in a single ballot.
        from app.paillier_scratch import encrypt
        cts.append(encrypt(pub, 50))
        c_total, _, _ = benchmark_tally(cts, pub["n"])
        result = run_js({"op": "decrypt", "privateKey": to_str_keys(priv),
                         "cTotal": str(c_total), "numCandidates": 2, "totalVotes": 4})
        self.assertFalse(result["integrity"]["verified"])


if __name__ == "__main__":
    unittest.main()
