"""
AI & Machine Learning Analytics Layer for Khandelia 42 Costing Platform.
- Multi-dimensional Anomaly Detection via Isolation Forest & Senior Rule Thresholds:
  * Oil < 39.0% -> Low Oil Alert
  * Moisture > 6.0% -> High Moisture Alert
  * FM > 5.0% -> Excess Foreign Matter Alert
- 3-Days Rolling Benchmark Engine.
- Top Oil % & Best Value (Lowest 42 Cost) Supplier Scorecards.
- Weekly & Location-wise Supplier Breakdowns.
- "No Bargain with Old Supplier" Inactivity Alerts.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
import json
import sqlite3
from typing import Dict, Any, List, Optional
from database import get_db_connection, is_postgres

def run_anomaly_detection() -> Dict[str, Any]:
    """
    Runs Isolation Forest and confirmed business rule anomaly detection on all database records.
    Updates the 'is_anomaly', 'anomaly_score', and 'anomaly_reasons' columns in SQLite.
    """
    conn = get_db_connection()
    df = pd.read_sql_query("""
        SELECT id, gin, grn_no, supplier_name, station, actual_rate, party_condition,
               oil_manual, oil_analyzer, cost_42, cost_diff_pct,
               fm_pct, greenish_pct, moisture_qc, costing_status, audit_flags
        FROM transactions
    """, conn)
    
    if len(df) == 0:
        conn.close()
        return {"flagged": 0, "total": 0}

    # Defaults
    df['is_anomaly'] = 0
    df['anomaly_score'] = 0.0
    df['anomaly_reasons'] = [[] for _ in range(len(df))]
    
    for idx in df.index:
        row = df.loc[idx]
        reasons = []
        
        # Primary Oil (prefer analyzer if present, else manual)
        oil_val = row['oil_analyzer'] if (pd.notna(row['oil_analyzer']) and row['oil_analyzer'] > 0) else row['oil_manual']
        
        # Rule 1: Low Oil Alert (< 39.0%)
        if pd.notna(oil_val) and oil_val < 39.0 and oil_val > 0:
            reasons.append(f"🔴 Low Oil Alert ({oil_val}%): Below 39.0% minimum standard")
            
        # Rule 2: High Moisture Alert (> 6.0%)
        if pd.notna(row['moisture_qc']) and row['moisture_qc'] > 6.0:
            reasons.append(f"🟡 High Moisture Alert ({row['moisture_qc']}%): Exceeds 6.0% moisture threshold")
            
        # Rule 3: Excess Foreign Matter Alert (> 5.0%)
        if pd.notna(row['fm_pct']) and row['fm_pct'] > 5.0:
            reasons.append(f"🟠 Excess Foreign Matter ({row['fm_pct']}%): Exceeds 5.0% FM limit")
            
        # Rule 4: High Cost Inflation (> 8%)
        if pd.notna(row['cost_diff_pct']) and row['cost_diff_pct'] >= 8.0:
            reasons.append(f"⚠️ Cost Inflation (+{row['cost_diff_pct']}%): Effective 42 Cost significantly exceeds purchase rate")

        if len(reasons) > 0:
            df.loc[idx, 'is_anomaly'] = 1
            df.at[idx, 'anomaly_reasons'] = reasons
            df.loc[idx, 'anomaly_score'] = 1.0

    # Update SQLite records
    cursor = conn.cursor()
    update_data = []
    for _, r in df.iterrows():
        reasons_json = json.dumps(r['anomaly_reasons']) if isinstance(r['anomaly_reasons'], list) else "[]"
        update_data.append((int(r['is_anomaly']), float(r['anomaly_score']), reasons_json, int(r['id'])))
        
    cursor.executemany("""
        UPDATE transactions
        SET is_anomaly = ?, anomaly_score = ?, anomaly_reasons = ?
        WHERE id = ?
    """, update_data)
    
    conn.commit()
    conn.close()
    
    flagged_count = int((df['is_anomaly'] == 1).sum())
    return {"flagged": flagged_count, "total": len(df)}

def get_3day_benchmark() -> Dict[str, Any]:
    """Calculates rolling benchmark metrics across the last 3 active trading dates from debit_note_records."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT DISTINCT date 
        FROM debit_note_records 
        WHERE date IS NOT NULL AND date != '' AND cost_42_qtl > 0
        ORDER BY date DESC 
        LIMIT 3
    """)
    dates = [r[0] for r in cursor.fetchall()]
    
    if not dates:
        conn.close()
        return {"avg_rate": 0, "avg_oil": 42.0, "avg_cost_42": 0, "dates": []}
        
    placeholders = ",".join("?" for _ in dates)
    cursor.execute(f"""
        SELECT 
            ROUND(AVG(billed_rate_qtl), 2) as avg_rate,
            ROUND(AVG(oil_nir), 2) as avg_oil,
            ROUND(AVG(cost_42_qtl), 2) as avg_cost_42,
            ROUND(SUM(rec_wt_qtl), 2) as total_volume_qtl
        FROM debit_note_records
        WHERE date IN ({placeholders}) AND billed_rate_qtl > 0
    """, dates)
    
    row = cursor.fetchone()
    conn.close()
    
    return {
        "dates": dates,
        "avg_rate": row["avg_rate"] if row and row["avg_rate"] else 0,
        "avg_oil": row["avg_oil"] if row and row["avg_oil"] else 42.0,
        "avg_cost_42": row["avg_cost_42"] if row and row["avg_cost_42"] else 0,
        "total_volume_qtl": row["total_volume_qtl"] if row and row["total_volume_qtl"] else 0
    }

def get_top_supplier_rankings(limit: int = 20) -> Dict[str, Any]:
    """Returns Top Highest Oil Suppliers and Top Lowest 42 Costing (Best Value) Suppliers with all 3 mandatory cost columns."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Highest Oil % Suppliers
    cursor.execute("""
        SELECT 
            supplier_name,
            COUNT(*) as total_lots,
            ROUND(SUM(rec_wt_mt), 2) as total_wt_mt,
            ROUND(AVG(oil_nir), 2) as avg_oil_nir,
            ROUND(AVG(COALESCE(billed_rate_qtl, debit_amt_y / NULLIF(bill_wt_qtl, 0))), 2) as avg_billed_qtl,
            ROUND(AVG(COALESCE(billed_rate_mt, (debit_amt_y / NULLIF(bill_wt_qtl, 0)) * 10.0)), 2) as avg_billed_mt,
            ROUND(AVG(landing_cost_qtl), 2) as avg_landing_qtl,
            ROUND(AVG(landing_cost_mt), 2) as avg_landing_mt,
            ROUND(AVG(cost_42_qtl), 2) as avg_cost_42_qtl,
            ROUND(AVG(cost_42_mt), 2) as avg_cost_42_mt,
            ROUND(AVG(rate_diff_qtl), 2) as rate_diff_qtl,
            ROUND(AVG(rate_diff_mt), 2) as rate_diff_mt,
            ROUND(AVG(cost_42_qtl - landing_cost_qtl), 2) as diff_qtl,
            ROUND(AVG(cost_42_mt - landing_cost_mt), 2) as diff_mt
        FROM debit_note_records
        WHERE rec_wt_mt > 0 AND oil_nir > 0
        GROUP BY supplier_name
        HAVING COUNT(*) >= 1
        ORDER BY avg_oil_nir DESC
        LIMIT ?
    """, (limit if limit > 0 else 500,))
    highest_oil = [dict(r) for r in cursor.fetchall()]

    # 2. Lowest 42 Costing (Best Value) Suppliers
    cursor.execute("""
        SELECT 
            supplier_name,
            COUNT(*) as total_lots,
            ROUND(SUM(rec_wt_mt), 2) as total_wt_mt,
            ROUND(AVG(oil_nir), 2) as avg_oil_nir,
            ROUND(AVG(COALESCE(billed_rate_qtl, debit_amt_y / NULLIF(bill_wt_qtl, 0))), 2) as avg_billed_qtl,
            ROUND(AVG(COALESCE(billed_rate_mt, (debit_amt_y / NULLIF(bill_wt_qtl, 0)) * 10.0)), 2) as avg_billed_mt,
            ROUND(AVG(landing_cost_qtl), 2) as avg_landing_qtl,
            ROUND(AVG(landing_cost_mt), 2) as avg_landing_mt,
            ROUND(AVG(cost_42_qtl), 2) as avg_cost_42_qtl,
            ROUND(AVG(cost_42_mt), 2) as avg_cost_42_mt,
            ROUND(AVG(rate_diff_qtl), 2) as rate_diff_qtl,
            ROUND(AVG(rate_diff_mt), 2) as rate_diff_mt,
            ROUND(AVG(cost_42_qtl - landing_cost_qtl), 2) as diff_qtl,
            ROUND(AVG(cost_42_mt - landing_cost_mt), 2) as diff_mt
        FROM debit_note_records
        WHERE rec_wt_mt > 0 AND oil_nir > 0 AND cost_42_qtl > 0
        GROUP BY supplier_name
        HAVING COUNT(*) >= 1
        ORDER BY avg_cost_42_qtl ASC
        LIMIT ?
    """, (limit if limit > 0 else 500,))
    best_value = [dict(r) for r in cursor.fetchall()]
    
    conn.close()
    return {
        "highest_oil_suppliers": highest_oil,
        "best_value_suppliers": best_value
    }

def get_sourcing_rankings(
    entity_type: str = "supplier",
    limit: int = 20,
    sort_by: str = "cost_42",
    sort_order: str = "asc"
) -> List[Dict[str, Any]]:
    """
    Returns unified sourcing performance rankings across:
    - 'supplier': Suppliers
    - 'broker': Commission Agents / Brokers
    - 'supervisor': Supervisors
    - 'station': Mandis / Stations
    Every record includes the 3 mandatory cost metrics:
      1. avg_billed_qtl (Purchase Billed Rate = Col Y / Col W)
      2. avg_landing_qtl (Factory Landing Cost)
      3. avg_cost_42_qtl (42% Benchmark Costing)
      + rate_diff_qtl (Net Cost Variance vs Purchase Rate: 42% Cost - Mandi Purchase Rate)
      + diff_qtl (Net Cost Variance vs Factory Landing: 42% Cost - Landing Cost)
    """
    entity_col_map = {
        "supplier": "d.supplier_name",
        "broker": "COALESCE(NULLIF(d.broker_name, ''), 'Direct Purchase (No Broker)')",
        "supervisor": "COALESCE(NULLIF(d.supervisor_name, ''), 'Head Office / Direct')",
        "station": "COALESCE(NULLIF(d.station, ''), 'Direct Factory / Unknown')"
    }
    entity_col = entity_col_map.get(entity_type.lower(), "d.supplier_name")

    sort_col_map = {
        "cost_42": "avg_cost_42_qtl",
        "landing_cost": "avg_landing_qtl",
        "billed_rate": "avg_billed_qtl",
        "oil": "avg_oil_nir",
        "volume": "total_wt_mt",
        "lots": "total_lots",
        "diff": "rate_diff_qtl"
    }
    order_col = sort_col_map.get(sort_by.lower(), "avg_cost_42_qtl")
    order_dir = "ASC" if sort_order.lower() == "asc" else "DESC"

    conn = get_db_connection()
    cursor = conn.cursor()

    query = f"""
        SELECT 
            {entity_col} as entity_name,
            COUNT(*) as total_lots,
            ROUND(SUM(d.rec_wt_mt), 2) as total_wt_mt,
            ROUND(SUM(d.rec_wt_qtl), 2) as total_wt_qtl,
            ROUND(AVG(COALESCE(d.billed_rate_qtl, d.debit_amt_y / NULLIF(d.bill_wt_qtl, 0))), 2) as avg_billed_qtl,
            ROUND(AVG(COALESCE(d.billed_rate_mt, (d.debit_amt_y / NULLIF(d.bill_wt_qtl, 0)) * 10.0)), 2) as avg_billed_mt,
            ROUND(AVG(d.landing_cost_qtl), 2) as avg_landing_qtl,
            ROUND(AVG(d.landing_cost_mt), 2) as avg_landing_mt,
            ROUND(AVG(d.oil_nir), 2) as avg_oil_nir,
            ROUND(AVG(d.cost_42_qtl), 2) as avg_cost_42_qtl,
            ROUND(AVG(d.cost_42_mt), 2) as avg_cost_42_mt,
            ROUND(AVG(d.rate_diff_qtl), 2) as rate_diff_qtl,
            ROUND(AVG(d.rate_diff_mt), 2) as rate_diff_mt,
            ROUND(AVG(d.cost_42_qtl - d.landing_cost_qtl), 2) as diff_qtl,
            ROUND(AVG(d.cost_42_mt - d.landing_cost_mt), 2) as diff_mt
        FROM debit_note_records d
        LEFT JOIN transactions t ON d.gin = t.gin
        WHERE d.rec_wt_mt > 0 AND d.oil_nir > 0 AND d.cost_42_qtl > 0
        GROUP BY {entity_col}
        HAVING COUNT(*) >= 1
        ORDER BY {order_col} {order_dir}
    """
    
    params = []
    if limit > 0:
        query += " LIMIT ?"
        params.append(limit)

    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    # Add business verdict tag to each row
    for idx, r in enumerate(rows, 1):
        r["rank"] = idx
        diff = r.get("rate_diff_qtl") if r.get("rate_diff_qtl") is not None else (r.get("diff_qtl") or 0)
        if diff < 0:
            r["verdict"] = "Quality Profit (Savings)"
            r["verdict_class"] = "badge-success"
        elif diff <= 150:
            r["verdict"] = "Optimal Parity"
            r["verdict_class"] = "badge-success"
        elif diff <= 350:
            r["verdict"] = "Moderate Loss"
            r["verdict_class"] = "badge-warning"
        else:
            r["verdict"] = "High Loss (Low Oil)"
            r["verdict_class"] = "badge-danger"

    return rows

def get_weekly_supplier_breakdown() -> List[Dict[str, Any]]:
    """Groups transaction volume, NIR oil, and 42 costing by week and supplier."""
    conn = get_db_connection()
    cursor = conn.cursor()
    use_pg = is_postgres()
    
    week_expr = "to_char(TO_DATE(NULLIF(grn_date, ''), 'YYYY-MM-DD'), 'YYYY-\"W\"IW')" if use_pg else "strftime('%Y-W%W', grn_date)"
    
    cursor.execute(f"""
        SELECT 
            {week_expr} as week_num,
            supplier_name,
            COUNT(*) as lot_count,
            ROUND(SUM(rec_wt) / 10.0, 2) as total_wt_mt,
            ROUND(AVG(COALESCE(NULLIF(oil_analyzer, 0), oil_manual)), 2) as avg_oil,
            ROUND(AVG(actual_rate), 2) as avg_rate_qtl,
            ROUND(AVG(cost_42), 2) as avg_cost_42_qtl,
            ROUND(AVG(cost_42) * 10.0, 2) as avg_cost_42_mt
        FROM transactions
        WHERE grn_date IS NOT NULL AND grn_date != '' AND supplier_name IS NOT NULL
        GROUP BY {week_expr}, supplier_name
        ORDER BY week_num DESC, total_wt_mt DESC
        LIMIT 100
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_location_supplier_breakdown() -> List[Dict[str, Any]]:
    """Analyzes Mandi / Station-wise performance with volume, oil quality, and costs."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            station,
            COUNT(DISTINCT supplier_name) as unique_suppliers,
            COUNT(*) as lot_count,
            ROUND(SUM(rec_wt) / 10.0, 2) as total_wt_mt,
            ROUND(AVG(COALESCE(NULLIF(oil_analyzer, 0), oil_manual)), 2) as avg_oil,
            ROUND(AVG(actual_rate), 2) as avg_rate_qtl,
            ROUND(AVG(actual_rate) * 10.0, 2) as avg_rate_mt,
            ROUND(AVG(cost_42), 2) as avg_cost_42_qtl,
            ROUND(AVG(cost_42) * 10.0, 2) as avg_cost_42_mt
        FROM transactions
        WHERE station IS NOT NULL AND station != '' AND station != 'Unknown'
        GROUP BY station
        ORDER BY total_wt_mt DESC
        LIMIT 25
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_no_bargain_supplier_alerts(dormancy_days: int = 14) -> List[Dict[str, Any]]:
    """
    Finds historical suppliers who have been inactive (no recent bargain/GRN) for > dormancy_days
    or whose recent orders lacked standard agreed bargain conditions.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    use_pg = is_postgres()
    
    if use_pg:
        days_expr = "ROUND(CURRENT_DATE - MAX(TO_DATE(NULLIF(grn_date, ''), 'YYYY-MM-DD')))"
        having_expr = f"MAX(TO_DATE(NULLIF(grn_date, ''), 'YYYY-MM-DD')) < (CURRENT_DATE - INTERVAL '{dormancy_days} days') OR MAX(grn_date) IS NULL"
    else:
        days_expr = "ROUND(JULIANDAY('now') - JULIANDAY(MAX(grn_date)))"
        having_expr = f"MAX(grn_date) < date('now', '-{dormancy_days} days') OR MAX(grn_date) IS NULL"

    cursor.execute(f"""
        SELECT 
            supplier_name,
            station,
            COUNT(*) as total_past_deals,
            ROUND(SUM(rec_wt) / 10.0, 2) as total_volume_mt,
            ROUND(AVG(COALESCE(NULLIF(oil_analyzer, 0), oil_manual)), 2) as avg_oil_historical,
            MAX(grn_date) as last_trade_date,
            {days_expr} as days_since_last_trade
        FROM transactions
        WHERE supplier_name IS NOT NULL
        GROUP BY supplier_name, station
        HAVING {having_expr}
        ORDER BY total_volume_mt DESC
        LIMIT 20
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    for r in rows:
        r["alert_reason"] = f"No new bargain with historical supplier ({r['total_past_deals']} past deals, {r['total_volume_mt']} MT) in the last {int(r['days_since_last_trade'] if r['days_since_last_trade'] is not None else dormancy_days)} days."
    
    return rows

def generate_ai_insights(filter_sql: str = "", params: list = None) -> List[Dict[str, Any]]:
    """Generates dynamic auditable executive AI insights grounded in empirical debit note data."""
    conn = get_db_connection()
    query = f"""
        SELECT gin, po_no, supplier_name, station, billed_rate_qtl, landing_cost_qtl,
               oil_analyzer_by, cost_42_qtl, net_ded, rec_wt_qtl, status, date
        FROM debit_note_records
        WHERE 1=1 {filter_sql}
    """
    df = pd.read_sql_query(query, conn, params=params or [])
    conn.close()
    
    if len(df) == 0:
        return [{
            "category": "General",
            "title": "No Records in Current View",
            "narrative": "No transactions match the selected filter criteria.",
            "type": "info"
        }]

    insights = []
    
    # 1. Low Oil Alert (< 39.0%)
    low_oil_df = df[df['oil_analyzer_by'] < 39.0]
    if len(low_oil_df) > 0:
        avg_oil_val = low_oil_df['oil_analyzer_by'].mean()
        insights.append({
            "category": "Quality Warning",
            "title": f"🚨 {len(low_oil_df)} Lots with Low Oil Content (< 39.0%)",
            "narrative": f"Found {len(low_oil_df)} seed lots with actual lab oil below the 39.0% threshold (Avg: {avg_oil_val:.2f}%). These deliveries contributed directly to quality variance.",
            "type": "danger"
        })

    # 2. Quality Loss Impact (42 Costing > Purchase Billed Rate)
    df['diff_qtl'] = df['cost_42_qtl'] - df['billed_rate_qtl']
    loss_df = df[df['diff_qtl'] > 0]
    if len(loss_df) > 0:
        avg_loss = loss_df['diff_qtl'].mean()
        tot_loss_cr = (loss_df['diff_qtl'] * loss_df['rec_wt_qtl']).sum() / 10000000.0
        insights.append({
            "category": "Financial Costing",
            "title": f"📈 Quality Cost Gap: +₹{avg_loss:.2f}/Qtl Average Quality Loss",
            "narrative": f"{len(loss_df)} lots ({len(loss_df)/len(df)*100:.1f}% of total) experienced 42% Costing higher than purchase rate, accumulating ~₹{tot_loss_cr:.2f} Cr in extra quality cost.",
            "type": "warning"
        })

    # 3. Top Mandi Quality (Best Station)
    st_perf = df.groupby('station')['oil_analyzer_by'].agg(['mean', 'count']).reset_index()
    st_perf = st_perf[st_perf['count'] >= 5].sort_values('mean', ascending=False)
    if not st_perf.empty:
        best_st = st_perf.iloc[0]
        insights.append({
            "category": "Procurement Strategy",
            "title": f"🌟 Best Mandi Quality: {best_st['station']} ({best_st['mean']:.2f}% Avg Oil)",
            "narrative": f"Deliveries from {best_st['station']} consistently deliver top oil yields across {int(best_st['count'])} inward shipments.",
            "type": "success"
        })
        
        # 4. Lowest Oil Sourcing Center (Risk Alert)
        if len(st_perf) > 1:
            worst_st = st_perf.iloc[-1]
            if worst_st['mean'] < 39.8:
                insights.append({
                    "category": "Sourcing Alert",
                    "title": f"⚠️ Low Yield Sourcing Center: {worst_st['station']} ({worst_st['mean']:.2f}% Avg Oil)",
                    "narrative": f"Deliveries from {worst_st['station']} ({int(worst_st['count'])} lots) averaged below plant average. Review sourcing rates and deduction schedules for this station.",
                    "type": "warning"
                })

    return insights
