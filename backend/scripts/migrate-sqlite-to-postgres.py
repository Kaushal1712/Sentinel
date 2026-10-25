"""Migration script to transfer data from SQLite to PostgreSQL for Sentinel."""

import os
import sys
import sqlite3
from sqlalchemy import create_engine, MetaData, Table

def migrate_db():
    sqlite_path = os.environ.get('SQLITE_PATH', '/data/footprint.db')
    pg_url = os.environ.get('PG_URL', '')

    if not pg_url:
        print(
            "Error: PG_URL environment variable is required.\n"
            "Set it to the target PostgreSQL connection URL before running this script.\n"
            "Example:\n"
            "  export PG_URL=postgresql://dfas:<password>@localhost:5432/dfas\n"
            "  python backend/scripts/migrate-sqlite-to-postgres.py"
        )
        sys.exit(1)

    if not os.path.exists(sqlite_path):
        print(f"SQLite DB not found at {sqlite_path}. Exiting.")
        sys.exit(0)

    print(f"Migrating data from {sqlite_path} to {pg_url}...")

    # Connect to SQLite
    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    # Connect to PostgreSQL explicitly
    pg_engine = create_engine(pg_url)

    try:
        from app import create_app
        from database import db
        app = create_app()

        with app.app_context():
            # Create all tables in PG
            db.create_all()
            print("Postgres schema built successfully.")

            # Simple metadata reflection to copy tables
            meta = MetaData()
            meta.reflect(bind=pg_engine)

            with pg_engine.begin() as pg_conn:
                for table_name in meta.tables:
                    sqlite_cur.execute(f"SELECT * FROM {table_name}")
                    rows = sqlite_cur.fetchall()
                    if rows:
                        table = Table(table_name, meta, autoload_with=pg_engine)
                        # We use dict(row) to convert sqlite3.Row to dictionary
                        pg_conn.execute(table.insert(), [dict(row) for row in rows])
                        print(f"Migrated {len(rows)} rows to {table_name}")

        print("Migration complete!")
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == '__main__':
    migrate_db()
