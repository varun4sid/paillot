"""FastAPI entry point.  Run from backend/:  uvicorn app.main:app --reload --host 0.0.0.0"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import close_pool, get_cursor, init_pool
from .routes import auth_routes, poll_routes, vote_routes


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    yield
    close_pool()


app = FastAPI(title="Paillier Voting Demo", lifespan=lifespan)

origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(poll_routes.router)
app.include_router(vote_routes.router)


@app.get("/api/health")
def health():
    with get_cursor() as cur:
        cur.execute("SELECT 1 AS ok")
        cur.fetchone()
    return {"status": "ok", "database": "connected"}
