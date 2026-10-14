from fastapi import APIRouter, HTTPException, status
from psycopg2 import errors

from ..auth import create_token, hash_password, verify_password
from ..database import get_cursor
from ..models import Credentials, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(body: Credentials):
    username = body.username.strip().lower()
    try:
        with get_cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, password_hash) VALUES (%s, %s) RETURNING id",
                (username, hash_password(body.password)),
            )
            user_id = cur.fetchone()["id"]
    except errors.UniqueViolation:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
    return {"token": create_token(user_id, username), "username": username}


@router.post("/login", response_model=TokenResponse)
def login(body: Credentials):
    username = body.username.strip().lower()
    with get_cursor() as cur:
        cur.execute("SELECT id, password_hash FROM users WHERE username = %s", (username,))
        user = cur.fetchone()
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    return {"token": create_token(user["id"], username), "username": username}
