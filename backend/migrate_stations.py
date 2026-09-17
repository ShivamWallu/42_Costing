"""
Fast migration script to canonically normalize and merge all Mandi / Station names in the database.
Executes grouped updates in milliseconds for both SQLite and Neon PostgreSQL.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import get_db_connection, is_postgres
from validator import normalize_station

def migrate_stations():
    conn = get_db_connection()
    c = conn.cursor()
    ph = "%s" if is_postgres() else "?"

    print(f"Starting station normalization migration (is_postgres: {is_postgres()})...")

    # 1. Get all distinct stations from debit_note_records and transactions
    c.execute("SELECT DISTINCT station FROM debit_note_records WHERE station IS NOT NULL")
    raw_dn = [r["station"] if is_postgres() or isinstance(r, dict) else r[0] for r in c.fetchall()]

    c.execute("SELECT DISTINCT station FROM transactions WHERE station IS NOT NULL")
    raw_t = [r["station"] if is_postgres() or isinstance(r, dict) else r[0] for r in c.fetchall()]

    all_raw = set(raw_dn + raw_t)
    print(f"Found {len(all_raw)} distinct station strings to map...")

    updates_count = 0
    for raw in all_raw:
        _, canonical, _ = normalize_station(raw)
        if raw != canonical:
            c.execute(f"UPDATE debit_note_records SET station = {ph} WHERE station = {ph}", (canonical, raw))
            c.execute(f"UPDATE transactions SET station = {ph} WHERE station = {ph}", (canonical, raw))
            updates_count += 1
            print(f"  Mapped '{raw}' -> '{canonical}'")

    conn.commit()
    print(f"\nMigration successfully committed {updates_count} distinct mappings!")

    # 2. Print verified summary
    c.execute("SELECT station, COUNT(*) as cnt FROM debit_note_records GROUP BY station ORDER BY cnt DESC")
    summary = c.fetchall()
    print(f"\nTotal Clean Unified Mandis: {len(summary)}")
    for s in summary:
        name = s["station"] if is_postgres() or isinstance(s, dict) else s[0]
        cnt = s["cnt"] if is_postgres() or isinstance(s, dict) else s[1]
        print(f"  • {name}: {cnt} lots")

    # Also migrate local SQLite database file if is_postgres is True
    if is_postgres():
        sqlite_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "khandelia_costing.db")
        if os.path.exists(sqlite_path):
            import sqlite3
            print(f"\nAlso updating local SQLite file: {sqlite_path}...")
            s_conn = sqlite3.connect(sqlite_path)
            s_c = s_conn.cursor()
            for raw in all_raw:
                _, canonical, _ = normalize_station(raw)
                if raw != canonical:
                    s_c.execute("UPDATE debit_note_records SET station = ? WHERE station = ?", (canonical, raw))
                    s_c.execute("UPDATE transactions SET station = ? WHERE station = ?", (canonical, raw))
            s_conn.commit()
            s_conn.close()
            print("Local SQLite file updated successfully!")

    conn.close()

if __name__ == "__main__":
    migrate_stations()
