import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

from runtime_config import BACKEND_DIR, DEFAULT_SQLITE_PATH

raw_database_url = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_SQLITE_PATH}")


def _normalize_database_url(database_url: str) -> str:
    if not database_url.startswith("sqlite:///"):
        return database_url

    sqlite_path = database_url.replace("sqlite:///", "", 1)
    if sqlite_path in (":memory:", ""):
        return database_url

    path = Path(sqlite_path)
    if not path.is_absolute():
        path = BACKEND_DIR / path

    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


SQLALCHEMY_DATABASE_URL = _normalize_database_url(raw_database_url)

connect_args = {}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
