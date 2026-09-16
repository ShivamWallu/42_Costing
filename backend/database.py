"""
Universal Database Layer for Khandelia 42 Costing Platform.
Supports both Neon PostgreSQL (Production on Render) and SQLite (Local Development/Fallback).
Includes automatic placeholder translation (? -> %s), connection management, and CRUD compatibility.
"""

import os
import sqlite3
import re
from typing import List, Dict, Any, Optional

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None

# Auto-load .env if present
def _load_env():
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

_load_env()

DB_PATH = os.path.join(os.path.dirname(__file__), "khandelia_costing.db")

class PostgresRowWrapper:
    """Wrapper around psycopg2 RealDictRow to support both dict key and tuple index access."""
    def __init__(self, dict_row):
        self._data = dict(dict_row) if dict_row is not None else {}
        self._keys = list(self._data.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._data[self._keys[key]]
        return self._data.get(key)

    def __contains__(self, key):
        return key in self._data

    def get(self, key, default=None):
        return self._data.get(key, default)

    def keys(self):
        return self._data.keys()

    def values(self):
        return self._data.values()

    def items(self):
        return self._data.items()

    def __iter__(self):
        return iter(self._keys)

    def __len__(self):
        return len(self._data)

    def __repr__(self):
        return repr(self._data)

class PostgresCursorWrapper:
    """Wrapper that translates SQLite '?' placeholders to PostgreSQL '%s' seamlessly."""
    def __init__(self, pg_cursor):
        self.cursor = pg_cursor

    def _convert_query(self, query: str) -> str:
        # Convert SQLite '?' placeholders to PostgreSQL '%s'
        return query.replace("?", "%s")

    def execute(self, query: str, params=None):
        pg_query = self._convert_query(query)
        if params is not None:
            if isinstance(params, (list, tuple)):
                return self.cursor.execute(pg_query, tuple(params))
            return self.cursor.execute(pg_query, (params,))
        return self.cursor.execute(pg_query)

    def executemany(self, query: str, params_list):
        pg_query = self._convert_query(query)
        return self.cursor.executemany(pg_query, params_list)

    def fetchone(self):
        row = self.cursor.fetchone()
        if row is None:
            return None
        return PostgresRowWrapper(row)

    def fetchall(self):
        rows = self.cursor.fetchall()
        return [PostgresRowWrapper(r) for r in rows]

    @property
    def description(self):
        return self.cursor.description

    @property
    def rowcount(self):
        return self.cursor.rowcount

    def close(self):
        return self.cursor.close()

class PostgresConnectionWrapper:
    """Wrapper around psycopg2 connection matching sqlite3.Connection interface."""
    def __init__(self, pg_conn):
        self.conn = pg_conn

    def cursor(self):
        return PostgresCursorWrapper(self.conn.cursor(cursor_factory=RealDictCursor))

    def commit(self):
        return self.conn.commit()

    def rollback(self):
        return self.conn.rollback()

    def close(self):
        return self.conn.close()

def get_db_connection():
    """
    Returns an active database connection:
    - If DATABASE_URL is set (e.g. Neon PostgreSQL), connects to PostgreSQL with automatic '?' -> '%s' translation.
    - Otherwise, falls back to local SQLite database.
    """
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and (db_url.startswith("postgres://") or db_url.startswith("postgresql://")):
        if psycopg2 is not None:
            # Normalize URL for psycopg2
            if db_url.startswith("postgres://"):
                db_url = "postgresql://" + db_url[len("postgres://"):]
            try:
                pg_conn = psycopg2.connect(db_url)
                return PostgresConnectionWrapper(pg_conn)
            except Exception as e:
                print(f"[Warning] Failed to connect to PostgreSQL ({e}), falling back to SQLite.")

    # SQLite fallback
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def is_postgres() -> bool:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    return bool(db_url and (db_url.startswith("postgres://") or db_url.startswith("postgresql://")))

def init_db():
    """Initializes database schema and indexes for either SQLite or PostgreSQL."""
    conn = get_db_connection()
    cursor = conn.cursor()
    use_pg = is_postgres()
    
    auto_id = "SERIAL PRIMARY KEY" if use_pg else "INTEGER PRIMARY KEY AUTOINCREMENT"
    
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS transactions (
        id {auto_id},
        gin TEXT,
        grn_no TEXT,
        po_no TEXT,
        supervisor_name TEXT,
        supplier_code TEXT,
        supplier_name TEXT,
        station TEXT,
        station_original TEXT,
        broker_name TEXT,
        broker_original TEXT,
        gin_date TEXT,
        grn_date TEXT,
        lab_report_date TEXT,
        bill_wt REAL,
        rec_wt REAL,
        gross_wt REAL,
        bill_amount REAL,
        actual_rate REAL,
        party_condition REAL,
        condition_rate_42 REAL,
        oil_manual REAL,
        oil_analyzer REAL,
        cost_42 REAL,
        costing_status TEXT,
        costing_message TEXT,
        cost_diff REAL,
        cost_diff_pct REAL,
        impact_type TEXT,
        oil_diff_condition REAL,
        oil_diff_analyzer REAL,
        analyzer_cost_42 REAL,
        theoretical_oil_weight_qtl REAL,
        fm_pct REAL,
        greenish_pct REAL,
        moisture_pre_pct REAL,
        moisture_qc REAL,
        ffa REAL,
        is_anomaly INTEGER DEFAULT 0,
        anomaly_score REAL DEFAULT 0.0,
        anomaly_reasons TEXT,
        audit_flags TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS sync_logs (
        id {auto_id},
        sync_source TEXT,
        total_rows INTEGER,
        new_rows INTEGER,
        updated_rows INTEGER,
        error_rows INTEGER,
        status TEXT,
        details TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS debit_note_records (
        id {auto_id},
        s_no INTEGER,
        gin TEXT,
        po_no TEXT,
        supplier_code TEXT,
        supplier_name TEXT,
        station TEXT,
        supervisor_name TEXT,
        broker_name TEXT,
        brokerage_rate REAL,
        date TEXT,
        bill_no TEXT,
        bill_wt_qtl REAL,
        rec_wt_mt REAL,
        rec_wt_qtl REAL,
        taxable_amt_an REAL,
        debit_amt_y REAL,
        billed_rate_qtl REAL,
        billed_rate_mt REAL,
        rate_diff_qtl REAL,
        rate_diff_mt REAL,
        net_ded REAL,
        landing_cost_mt REAL,
        landing_cost_qtl REAL,
        oil_nir REAL,
        oil_analyzer_by REAL,
        oil_analyzer_ax REAL,
        oil_nir_diff REAL,
        oil_mismatch_flag INTEGER DEFAULT 0,
        fm_pct REAL,
        greenish_pct REAL,
        moisture_pct REAL,
        cost_42_mt REAL,
        cost_42_qtl REAL,
        diff_qtl REAL,
        diff_mt REAL,
        final_effective_cost_mt REAL,
        status TEXT,
        remarks TEXT,
        oil_ded REAL,
        bardana_ded REAL,
        fm_ded REAL,
        brokerage_ded REAL,
        shortage_ded REAL,
        greenish_ded REAL,
        moisture_ded REAL
    );
    """)

    # Indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_gin ON transactions(gin);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_supplier ON transactions(supplier_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_station ON transactions(station);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_supervisor ON transactions(supervisor_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_gin_date ON transactions(gin_date);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_is_anomaly ON transactions(is_anomaly);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_cost_status ON transactions(costing_status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dn_gin ON debit_note_records(gin);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dn_supp ON debit_note_records(supplier_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dn_station ON debit_note_records(station);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dn_super ON debit_note_records(supervisor_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_dn_status ON debit_note_records(status);")

    # Sarso Market AI Predictions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sarso_predictions (
        id TEXT PRIMARY KEY,
        prediction_date TEXT,
        prediction_time TEXT,
        timestamp TEXT,
        state TEXT,
        mandi TEXT,
        variety TEXT,
        current_price REAL,
        target_price REAL,
        expected_range_min REAL,
        expected_range_max REAL,
        most_likely_price REAL,
        market_bias TEXT,
        confidence_score REAL,
        expected_movement TEXT,
        positive_factors TEXT,
        negative_factors TEXT,
        risk_factors TEXT,
        intl_impact TEXT,
        mandi_impact TEXT,
        historical_trend_impact TEXT,
        news_impact TEXT,
        international_snapshot TEXT,
        mandi_snapshot TEXT,
        historical_snapshot TEXT,
        news_sources TEXT,
        ai_analysis TEXT,
        engine_used TEXT,
        is_fallback INTEGER DEFAULT 0,
        actual_price REAL,
        price_difference REAL,
        error_pct REAL,
        direction_correct INTEGER,
        actual_updated_at TEXT
    );
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sarso_date ON sarso_predictions(prediction_date);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sarso_state ON sarso_predictions(state);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sarso_mandi ON sarso_predictions(mandi);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sarso_bias ON sarso_predictions(market_bias);")

    conn.commit()
    conn.close()
    print("Database schema and indexes initialized.")

if __name__ == "__main__":
    init_db()
