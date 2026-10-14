"""PostgreSQL (Supabase) connection pool using psycopg2."""

import os
from contextlib import contextmanager
from pathlib import Path

from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")

_pool: ThreadedConnectionPool | None = None


def init_pool():
    global _pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set (see backend/.env.example)")
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 10, DATABASE_URL, cursor_factory=RealDictCursor)


def close_pool():
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


@contextmanager
def get_cursor():
    """Yields a dict cursor inside a transaction: commit on success, rollback on error."""
    if _pool is None:
        init_pool()
    conn = _pool.getconn()
    try:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


def apply_schema():
    """Create tables from schema.sql (idempotent). Useful for local testing."""
    sql = (Path(__file__).resolve().parent.parent / "schema.sql").read_text()
    with get_cursor() as cur:
        cur.execute(sql)
