"""
Migration Utility: Copies all data from local SQLite (khandelia_costing.db) to Neon PostgreSQL.
Can be executed locally or run as a post-deploy step on Render.
"""

import os
import sys
import sqlite3

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("[Error] psycopg2 is required. Please install via: pip install psycopg2-binary")
    sys.exit(1)

# Auto-load .env
for base in [os.path.dirname(__file__), os.path.join(os.path.dirname(__file__), "..")]:
    env_file = os.path.join(base, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip().strip("'\""))
        except Exception:
            pass

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
SQLITE_PATH = os.path.join(os.path.dirname(__file__), "khandelia_costing.db")

def run_migration():
    if not DATABASE_URL or not (DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")):
        print("[Error] DATABASE_URL is not set or invalid in .env or environment.")
        print("Please set DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require")
        return

    db_url = DATABASE_URL
    if db_url.startswith("postgres://"):
        db_url = "postgresql://" + db_url[len("postgres://"):]

    if not os.path.exists(SQLITE_PATH):
        print(f"[Error] SQLite database not found at: {SQLITE_PATH}")
        return

    print(f"Connecting to Neon PostgreSQL...")
    pg_conn = psycopg2.connect(db_url)
    pg_cur = pg_conn.cursor()

    # Initialize Postgres tables
    from database import init_db
    os.environ["DATABASE_URL"] = db_url
    print("Ensuring Neon schema is initialized...")
    init_db()

    # Connect to SQLite
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    tables_to_migrate = ["debit_note_records", "transactions", "sarso_predictions", "sync_logs"]

    for table in tables_to_migrate:
        try:
            sqlite_cur.execute(f"SELECT * FROM {table}")
            rows = sqlite_cur.fetchall()
            if not rows:
                print(f"[-] Table '{table}' has 0 rows in SQLite. Skipping.")
                continue

            # Check if target already has rows
            pg_cur.execute(f"SELECT COUNT(*) FROM {table}")
            pg_count = pg_cur.fetchone()[0]
            if pg_count > 0:
                print(f"[*] Table '{table}' already has {pg_count} rows in Neon. Skipping to avoid duplicate entries.")
                continue

            columns = [col[0] for col in sqlite_cur.description]
            col_names_str = ", ".join(columns)
            placeholders_str = ", ".join(["%s"] * len(columns))

            insert_query = f"INSERT INTO {table} ({col_names_str}) VALUES ({placeholders_str})"

            data_tuples = [tuple(row[col] for col in columns) for row in rows]
            
            # Batch execute
            execute_values(pg_cur, f"INSERT INTO {table} ({col_names_str}) VALUES %s", data_tuples)
            pg_conn.commit()
            print(f"[+] Successfully migrated {len(data_tuples)} records into Neon table '{table}'!")

        except Exception as e:
            print(f"[!] Error migrating table '{table}': {e}")
            pg_conn.rollback()

    sqlite_conn.close()
    pg_conn.close()
    print("\n Migration to Neon PostgreSQL completed successfully!")

if __name__ == "__main__":
    run_migration()
