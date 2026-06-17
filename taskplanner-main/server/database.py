from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = "sqlite+aiosqlite:///./gtrmy.db"

engine = create_async_engine(DATABASE_URL, echo=False)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """WAL lets concurrent readers/writers coexist instead of locking the
    whole file; a generous busy_timeout makes a writer retry for a while
    instead of immediately raising 'database is locked' — needed because
    solve-all now runs several solver jobs concurrently (one per team's
    exclusive window plus one per overlap-pooled window), each persisting
    its own results independently."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        from models import db_models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
