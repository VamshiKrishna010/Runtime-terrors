"""Additive SQLite development migrations; existing rows are never dropped."""
from datetime import datetime, timezone
from pathlib import Path
import logging
import sqlite3
from contextlib import closing
from sqlalchemy import inspect
from sqlmodel import SQLModel, Session, select
from .models import Evidence, Report
from .evidence import inspect_bytes
from .services import make_evidence, upload_path

log = logging.getLogger(__name__)


def initialize(engine, uploads):
    tables = inspect(engine).get_table_names()
    needs_column = "incident" in tables and "updated_at" not in {c["name"] for c in inspect(engine).get_columns("incident")}
    needs_tables = "evidence" not in tables or "vote" not in tables
    # SQLite's backup API includes committed WAL data; do not copy a live DB file.
    database = engine.url.database
    if tables and (needs_column or needs_tables) and database and database != ":memory:":
        backup = Path(database).with_suffix(f".migration-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}.bak")
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as destination:
            source.backup(destination)
    with engine.begin() as connection:
        if needs_column:
            connection.exec_driver_sql("ALTER TABLE incident ADD COLUMN updated_at DATETIME")
            connection.exec_driver_sql("UPDATE incident SET updated_at = created_at WHERE updated_at IS NULL")
    SQLModel.metadata.create_all(engine)
    # Backfill only real, existing attachments. Missing files remain report-only.
    with Session(engine) as session:
        linked = set(session.exec(select(Evidence.report_id)).all())
        for report in session.exec(select(Report)).all():
            if report.id in linked or not report.image_path or not report.image_path.startswith("/uploads/"):
                continue
            try:
                filename = report.image_path.removeprefix("/uploads/")
                path = upload_path(uploads, filename)
                if not path.is_file():
                    continue
                info = inspect_bytes(path.read_bytes())
                session.add(make_evidence(report, filename, None, info, path.stat().st_size, legacy=True))
            except (ValueError, OSError):
                log.warning("Could not index existing evidence for report %s", report.id)
        session.commit()
