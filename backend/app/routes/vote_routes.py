from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from psycopg2 import errors

from ..database import get_cursor
from ..models import VoteCast

router = APIRouter(prefix="/api/polls", tags=["votes"])


@router.post("/{poll_id}/vote", status_code=201)
def cast_vote(poll_id: UUID, body: VoteCast):
    """Stores an already-encrypted ballot. The server never sees the plaintext choice."""
    try:
        with get_cursor() as cur:
            # Row lock serialises concurrent voters so max_votes can't be exceeded.
            cur.execute(
                "SELECT is_active, max_votes, pub_n FROM polls WHERE id = %s FOR UPDATE",
                (str(poll_id),),
            )
            poll = cur.fetchone()
            if not poll:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Poll not found")
            if not poll["is_active"]:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Poll is closed")

            n = int(poll["pub_n"])
            c = int(body.ciphertext)
            if not 0 < c < n * n:
                raise HTTPException(422,
                                    "Ciphertext is not in Z*_{n^2}")

            cur.execute("SELECT COUNT(*)::int AS cnt FROM votes WHERE poll_id = %s", (str(poll_id),))
            count = cur.fetchone()["cnt"]
            if count >= poll["max_votes"]:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Maximum number of votes reached")

            cur.execute(
                """INSERT INTO votes (poll_id, voter_uuid, ciphertext, encryption_time_ms, expansion_ratio)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (str(poll_id), str(body.voter_uuid), body.ciphertext,
                 body.encryption_time_ms, body.expansion_ratio),
            )
            vote_id = cur.fetchone()["id"]
    except errors.UniqueViolation:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already voted")

    return {"vote_id": vote_id, "current_vote_count": count + 1}
