"""
SQLite Database Layer for Khandelia 42 Costing Platform.
Includes schema definition, connection management, indexing, and CRUD queries.
"""

import sqlite3
import os
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "khandelia_costing.db")

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes SQLite database schema and indexes."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS debit_note_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    # Indexes for fast filtering and KPI aggregation
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
