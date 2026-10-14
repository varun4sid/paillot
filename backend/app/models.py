"""Request/response schemas. The database tables themselves are defined in ../schema.sql."""

from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from .paillier_scratch import MAX_CANDIDATES, MAX_VOTES


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=72)   # bcrypt's 72-byte limit


class TokenResponse(BaseModel):
    token: str
    username: str


class PollCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    candidates: list[str]
    max_votes: int = Field(default=50, ge=1, le=MAX_VOTES)
    key_bits: int = 512

    @field_validator("candidates")
    @classmethod
    def check_candidates(cls, v):
        v = [c.strip() for c in v]
        if not 2 <= len(v) <= MAX_CANDIDATES:
            raise ValueError(f"between 2 and {MAX_CANDIDATES} candidates required")
        if any(not c for c in v):
            raise ValueError("candidate names cannot be empty")
        if len(set(v)) != len(v):
            raise ValueError("candidate names must be unique")
        return v

    @field_validator("key_bits")
    @classmethod
    def check_key_bits(cls, v):
        if v not in (512, 1024, 2048):
            raise ValueError("key_bits must be 512, 1024 or 2048")
        return v


class VoteCast(BaseModel):
    voter_uuid: UUID
    ciphertext: str = Field(pattern=r"^[0-9]+$", max_length=1300)  # base-10, < n^2
    encryption_time_ms: float | None = Field(default=None, ge=0)
    expansion_ratio: float | None = Field(default=None, ge=0)
