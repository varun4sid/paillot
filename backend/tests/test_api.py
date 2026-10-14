"""
End-to-end API test against a real PostgreSQL database (local Docker or Supabase).
Skipped unless DATABASE_URL and JWT_SECRET are set (backend/.env is loaded).
Test users are deleted at the end (ON DELETE CASCADE removes their polls/votes).

Run:  python -m unittest tests.test_api -v
"""

import os
import shutil
import unittest
import uuid

from app.database import DATABASE_URL

if DATABASE_URL and os.environ.get("JWT_SECRET"):
    from fastapi.testclient import TestClient

    from app.database import get_cursor
    from app.main import app
    from tests.test_cross_language import run_js


@unittest.skipUnless(DATABASE_URL and os.environ.get("JWT_SECRET") and shutil.which("node"),
                     "DATABASE_URL / JWT_SECRET / node not available")
class ApiFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app).__enter__()
        cls.usernames = []

    @classmethod
    def tearDownClass(cls):
        with get_cursor() as cur:
            cur.execute("DELETE FROM users WHERE username = ANY(%s)", (cls.usernames,))
        cls.client.__exit__(None, None, None)

    def _register(self):
        name = f"test_{uuid.uuid4().hex[:10]}"
        self.usernames.append(name)
        r = self.client.post("/api/auth/register", json={"username": name, "password": "secret123"})
        self.assertEqual(r.status_code, 201, r.text)
        return name, {"Authorization": f"Bearer {r.json()['token']}"}

    def _vote(self, poll_id, ballot, voter=None):
        return self.client.post(f"/api/polls/{poll_id}/vote", json={
            "voter_uuid": voter or str(uuid.uuid4()),
            "ciphertext": ballot["ciphertext"],
            "encryption_time_ms": ballot["encryptionTimeMs"],
            "expansion_ratio": ballot["expansionRatio"],
        })

    def test_auth(self):
        name, _ = self._register()
        r = self.client.post("/api/auth/register", json={"username": name, "password": "secret123"})
        self.assertEqual(r.status_code, 409)
        r = self.client.post("/api/auth/login", json={"username": name, "password": "secret123"})
        self.assertEqual(r.status_code, 200)
        r = self.client.post("/api/auth/login", json={"username": name, "password": "wrongpass"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.client.post("/api/polls", json={}).status_code, 401)

    def test_validation(self):
        _, h = self._register()
        bad = [
            {"title": "x", "candidates": ["only one"]},
            {"title": "x", "candidates": [str(i) for i in range(11)]},
            {"title": "x", "candidates": ["a", "b"], "max_votes": 1000},
            {"title": "x", "candidates": ["a", "b"], "key_bits": 256},
        ]
        for body in bad:
            self.assertEqual(self.client.post("/api/polls", json=body, headers=h).status_code, 422)

    def test_full_election(self):
        _, h = self._register()
        r = self.client.post("/api/polls", headers=h, json={
            "title": "Best language", "candidates": ["Python", "JS", "Rust"],
            "max_votes": 10, "key_bits": 512,
        })
        self.assertEqual(r.status_code, 201, r.text)
        created = r.json()
        poll_id, priv = created["id"], created["private_key"]

        # Private key is never stored in the DB.
        with get_cursor() as cur:
            cur.execute("SELECT * FROM polls WHERE id = %s", (poll_id,))
            row = cur.fetchone()
        self.assertNotIn(priv["lambda"], [str(v) for v in row.values()])
        self.assertNotIn(priv["mu"], [str(v) for v in row.values()])

        poll = self.client.get(f"/api/polls/{poll_id}").json()
        self.assertNotIn("private_key", poll)
        self.assertNotIn("encrypted_tally", poll)
        pub = {"n": poll["pub_n"], "g": poll["pub_g"]}

        votes = [0, 0, 1, 2, 2, 2, 1]
        ballots = run_js({"op": "encrypt", "publicKey": pub, "votes": votes})
        voters = [str(uuid.uuid4()) for _ in votes]
        for b, v in zip(ballots, voters):
            self.assertEqual(self._vote(poll_id, b, v).status_code, 201)

        # Double vote from same browser -> 409
        self.assertEqual(self._vote(poll_id, ballots[0], voters[0]).status_code, 409)
        # Garbage ciphertext -> 422
        self.assertEqual(self._vote(poll_id, {"ciphertext": "0", "encryptionTimeMs": 1,
                                              "expansionRatio": 1}).status_code, 422)
        self.assertEqual(self.client.get(f"/api/polls/{poll_id}").json()["current_vote_count"], 7)

        # Another user cannot close it.
        _, other = self._register()
        self.assertEqual(self.client.post(f"/api/polls/{poll_id}/close", headers=other).status_code, 403)

        r = self.client.post(f"/api/polls/{poll_id}/close", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        closed = r.json()
        self.assertFalse(closed["is_active"])
        self.assertIsNotNone(closed["tally_time_ms"])
        self.assertGreater(closed["avg_encryption_time_ms"], 0)

        # Voting after close -> 403
        extra = run_js({"op": "encrypt", "publicKey": pub, "votes": [0]})[0]
        self.assertEqual(self._vote(poll_id, extra).status_code, 403)

        result = run_js({"op": "decrypt", "privateKey": priv, "cTotal": closed["encrypted_tally"],
                         "numCandidates": 3, "totalVotes": closed["current_vote_count"]})
        self.assertEqual(result["counts"], [2, 2, 3])
        self.assertTrue(result["integrity"]["verified"])

        mine = self.client.get("/api/polls", headers=h).json()
        self.assertEqual([p["id"] for p in mine], [poll_id])

    def test_max_votes(self):
        _, h = self._register()
        poll = self.client.post("/api/polls", headers=h, json={
            "title": "Tiny", "candidates": ["A", "B"], "max_votes": 2}).json()
        pub = {"n": poll["pub_n"], "g": poll["pub_g"]}
        ballots = run_js({"op": "encrypt", "publicKey": pub, "votes": [0, 1, 1]})
        codes = [self._vote(poll["id"], b).status_code for b in ballots]
        self.assertEqual(codes, [201, 201, 403])


if __name__ == "__main__":
    unittest.main()
