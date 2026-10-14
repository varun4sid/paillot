from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg2.extras import Json

from ..auth import get_current_user
from ..database import get_cursor
from ..models import PollCreate
from ..paillier_scratch import BASE_M, benchmark_tally, generate_paillier_keypair

router = APIRouter(prefix="/api/polls", tags=["polls"])

_POLL_COLUMNS = """
    p.id, p.creator_id, p.title, p.candidates, p.base_m, p.max_votes, p.pub_n, p.pub_g,
    p.is_active, p.encrypted_tally, p.tally_time_ms, p.plaintext_time_ms, p.created_at,
    (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id)::int AS current_vote_count
"""


def _fetch_poll(cur, poll_id: UUID) -> dict:
    cur.execute(f"SELECT {_POLL_COLUMNS} FROM polls p WHERE p.id = %s", (str(poll_id),))
    poll = cur.fetchone()
    if not poll:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Poll not found")
    return poll


def _vote_metrics(cur, poll_id) -> dict:
    cur.execute(
        """SELECT AVG(encryption_time_ms) AS avg_encryption_time_ms,
                  AVG(expansion_ratio)    AS avg_expansion_ratio
           FROM votes WHERE poll_id = %s""",
        (str(poll_id),),
    )
    return cur.fetchone()


def _public_view(poll: dict, metrics: dict | None = None) -> dict:
    out = {k: poll[k] for k in (
        "id", "title", "candidates", "base_m", "max_votes", "pub_n", "pub_g",
        "is_active", "current_vote_count", "created_at",
    )}
    out["creator_id"] = str(poll["creator_id"])
    if not poll["is_active"]:
        out.update(
            encrypted_tally=poll["encrypted_tally"],
            tally_time_ms=poll["tally_time_ms"],
            plaintext_time_ms=poll["plaintext_time_ms"],
            **(metrics or {}),
        )
    return out


@router.post("", status_code=201)
def create_poll(body: PollCreate, user: dict = Depends(get_current_user)):
    """Generates a fresh Paillier keypair. Only the public key is stored; the private
    key is returned exactly once in this response and never persisted."""
    public_key, private_key = generate_paillier_keypair(body.key_bits)

    with get_cursor() as cur:
        cur.execute(
            """INSERT INTO polls (creator_id, title, candidates, base_m, max_votes, pub_n, pub_g)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (user["id"], body.title.strip(), Json(body.candidates), BASE_M,
             body.max_votes, str(public_key["n"]), str(public_key["g"])),
        )
        poll = _fetch_poll(cur, cur.fetchone()["id"])

    return {
        **_public_view(poll),
        "key_bits": body.key_bits,
        "private_key": {
            "lambda": str(private_key["lambda"]),
            "mu": str(private_key["mu"]),
            "n": str(private_key["n"]),
        },
    }


@router.get("")
def list_my_polls(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute(
            f"SELECT {_POLL_COLUMNS} FROM polls p WHERE p.creator_id = %s ORDER BY p.created_at DESC",
            (user["id"],),
        )
        rows = cur.fetchall()
    return [
        {k: r[k] for k in ("id", "title", "candidates", "max_votes", "is_active",
                           "current_vote_count", "created_at")}
        for r in rows
    ]


@router.get("/{poll_id}")
def get_poll(poll_id: UUID):
    with get_cursor() as cur:
        poll = _fetch_poll(cur, poll_id)
        metrics = None if poll["is_active"] else _vote_metrics(cur, poll_id)
    return _public_view(poll, metrics)


@router.post("/{poll_id}/close")
def close_poll(poll_id: UUID, user: dict = Depends(get_current_user)):
    """Closes the poll and computes C_total = prod(c_j) mod n^2 on the server."""
    with get_cursor() as cur:
        # Lock the poll row so no vote can slip in while we tally.
        cur.execute("SELECT creator_id FROM polls WHERE id = %s FOR UPDATE", (str(poll_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Poll not found")
        if str(row["creator_id"]) != user["id"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the poll creator can close it")

        poll = _fetch_poll(cur, poll_id)
        if not poll["is_active"] and poll["encrypted_tally"] is not None:
            return _public_view(poll, _vote_metrics(cur, poll_id))   # already closed

        cur.execute("SELECT ciphertext FROM votes WHERE poll_id = %s", (str(poll_id),))
        ciphertexts = [int(r["ciphertext"]) for r in cur.fetchall()]

        c_total, tally_ms, plain_ms = benchmark_tally(ciphertexts, int(poll["pub_n"]))

        cur.execute(
            """UPDATE polls SET is_active = FALSE, encrypted_tally = %s,
                      tally_time_ms = %s, plaintext_time_ms = %s
               WHERE id = %s""",
            (str(c_total), tally_ms, plain_ms, str(poll_id)),
        )
        poll = _fetch_poll(cur, poll_id)
        return _public_view(poll, _vote_metrics(cur, poll_id))
