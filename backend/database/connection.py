"""
connection.py handles both raw MySQL connections and SQLAlchemy sessions.
"""

import os
import threading

from mysql.connector import pooling
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DB_HOST = os.getenv("DB_HOST")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_POOL_SIZE = max(1, min(20, int(os.getenv("DB_POOL_SIZE", "5"))))
_raw_pool = None
_raw_pool_lock = threading.Lock()


def _validate_env() -> None:
    missing = []

    if not DB_HOST:
        missing.append("DB_HOST")
    if not DB_USER:
        missing.append("DB_USER")
    if not DB_PASSWORD:
        missing.append("DB_PASSWORD")
    if not DB_NAME:
        missing.append("DB_NAME")

    if missing:
        raise RuntimeError(
            f"Missing required database environment variables: {', '.join(missing)}"
        )


def get_connection():
    global _raw_pool
    _validate_env()
    if _raw_pool is None:
        with _raw_pool_lock:
            if _raw_pool is None:
                _raw_pool = pooling.MySQLConnectionPool(
                    pool_name="hiresense_raw",
                    pool_size=DB_POOL_SIZE,
                    pool_reset_session=True,
                    host=DB_HOST,
                    user=DB_USER,
                    password=DB_PASSWORD,
                    database=DB_NAME,
                    port=int(DB_PORT),
                )
    connection = _raw_pool.get_connection()
    if not connection.is_connected():
        connection.reconnect(attempts=2, delay=0)
    return connection


_validate_env()

SQLALCHEMY_DATABASE_URL = URL.create(
    drivername="mysql+mysqlconnector",
    username=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=int(DB_PORT),
    database=DB_NAME,
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=280,
    pool_size=DB_POOL_SIZE,
    max_overflow=max(1, DB_POOL_SIZE // 2),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
