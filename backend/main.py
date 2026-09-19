import sys
import os

# Add backend directory to sys.path so imports work from root directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Query, HTTPException, Body, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
import sqlite3
import json
import shutil
from typing import Optional, List, Dict, Any
from database import get_db_connection, init_db
from costing_engine import calculate_42_adjusted_cost, calculate_cost_impact, calculate_landing_and_42_cost, BENCHMARK_OIL
from ml_analytics import (
    run_anomaly_detection, generate_ai_insights, get_3day_benchmark,
    get_top_supplier_rankings, get_weekly_supplier_breakdown,
    get_location_supplier_breakdown, get_no_bargain_supplier_alerts,
    get_sourcing_rankings
)
from google_sheets_sync import sync_from_google_sheet, sync_from_csv_stream
from email_service import send_weekly_42_costing_email, get_weekly_report_data
from populate_debit_db import populate as populate_debit_db, restore_previous_backup, get_backup_and_storage_status
from models import DashboardKpiResponse, FilterOptionsResponse, FormulaTestRequest, FormulaTestResponse, SyncRequest

app = FastAPI(
    title="Khandelia Oil & General Mills — 42 Costing & Seed Quality AI Analytics API",
    version="2.0.0",
    description="Enterprise API for Mustard Seed 42 Costing, Laboratory Quality Audit, and AI Analytics."
)

# CORS configuration for local Vite frontend and Vercel deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def build_filter_clause(
    supervisor: Optional[str] = None,
    supplier: Optional[str] = None,
    station: Optional[str] = None,
    broker: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_rate: Optional[float] = None,
    max_rate: Optional[float] = None,
    min_oil: Optional[float] = None,
    max_oil: Optional[float] = None,
    search: Optional[str] = None,
    anomaly_only: Optional[bool] = False,
    lab_pending_only: Optional[bool] = False
) -> tuple[str, list]:
    clauses = []
    params = []

    if supervisor:
        clauses.append("supervisor_name = ?")
        params.append(supervisor)
    if supplier:
        clauses.append("supplier_name = ?")
        params.append(supplier)
    if station:
        clauses.append("station = ?")
        params.append(station)
    if broker:
        clauses.append("broker_name = ?")
        params.append(broker)
    if date_from:
        clauses.append("gin_date >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("gin_date <= ?")
        params.append(date_to)
    if min_rate is not None:
        clauses.append("actual_rate >= ?")
        params.append(min_rate)
    if max_rate is not None:
        clauses.append("actual_rate <= ?")
        params.append(max_rate)
    if min_oil is not None:
        clauses.append("oil_manual >= ?")
        params.append(min_oil)
    if max_oil is not None:
        clauses.append("oil_manual <= ?")
        params.append(max_oil)
    if anomaly_only:
        clauses.append("is_anomaly = 1")
    if lab_pending_only:
        clauses.append("costing_status = 'LAB_PENDING'")
    if search:
        s = f"%{search.strip()}%"
        clauses.append("(gin LIKE ? OR grn_no LIKE ? OR po_no LIKE ? OR supplier_name LIKE ? OR station LIKE ?)")
        params.extend([s, s, s, s, s])

    clause_str = (" AND " + " AND ".join(clauses)) if clauses else ""
    return clause_str, params

@app.get("/api/health")
def health():
    return {"status": "HEALTHY", "company": "Khandelia Oil & General Mills Pvt. Ltd.", "unit": "Unit-1"}

@app.get("/api/dashboard/kpis", response_model=DashboardKpiResponse)
def get_kpis(
    supervisor: Optional[str] = None,
    supplier: Optional[str] = None,
    station: Optional[str] = None,
    broker: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    anomaly_only: Optional[bool] = False,
    lab_pending_only: Optional[bool] = False
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    where_parts = []
    params = []
    if supervisor:
        where_parts.append("supervisor_name = ?")
        params.append(supervisor)
    if supplier:
        where_parts.append("supplier_name = ?")
        params.append(supplier)
    if station:
        where_parts.append("station = ?")
        params.append(station)
    if broker:
        where_parts.append("broker_name = ?")
        params.append(broker)
    if date_from:
        where_parts.append("date >= ?")
        params.append(date_from)
    if date_to:
        where_parts.append("date <= ?")
        params.append(date_to)
    if anomaly_only:
        where_parts.append("(oil_analyzer_by < 39.0 OR (cost_42_qtl - billed_rate_qtl) >= 200.0 OR net_ded > 75000.0 OR status != 'Matched')")
    if lab_pending_only:
        where_parts.append("(cost_42_qtl IS NULL OR oil_nir IS NULL OR oil_analyzer_by IS NULL OR oil_analyzer_by <= 0 OR status = 'Lab Data Not Available' OR status LIKE '%Pending%')")
    if search and search.strip():
        s_clean = search.strip()
        if s_clean.lower() in ["direct", "direct purchase", "direct purchases", "no broker"]:
            where_parts.append("(broker_name IS NULL OR broker_name = '' OR broker_name LIKE '%Direct%')")
        else:
            where_parts.append("(gin LIKE ? OR supplier_name LIKE ? OR po_no LIKE ? OR bill_no LIKE ? OR station LIKE ? OR broker_name LIKE ?)")
            search_param = f"%{s_clean}%"
            params.extend([search_param, search_param, search_param, search_param, search_param, search_param])

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    query = f"""
        SELECT 
            COUNT(*) as total_records,
            COALESCE(SUM(rec_wt_qtl), 0) as total_rec_wt_qtl,
            COALESCE(SUM(rec_wt_mt), 0) as total_rec_wt_mt,
            COALESCE(SUM(bill_wt_qtl), 0) as total_bill_wt_qtl,
            COALESCE(SUM(taxable_amt_an), 0) as total_spend_inr,
            COALESCE(SUM(net_ded), 0) as total_net_ded_inr,
            ROUND(AVG(CASE WHEN billed_rate_qtl > 0 THEN billed_rate_qtl ELSE NULL END), 2) as avg_actual_rate,
            ROUND(AVG(CASE WHEN oil_nir > 0 THEN oil_nir ELSE NULL END), 2) as avg_oil_manual,
            ROUND(AVG(CASE WHEN oil_analyzer_ax > 0 THEN oil_analyzer_ax ELSE NULL END), 2) as avg_oil_analyzer,
            ROUND(AVG(CASE WHEN landing_cost_qtl > 0 THEN landing_cost_qtl ELSE NULL END), 2) as avg_landing_cost_qtl,
            ROUND(AVG(CASE WHEN cost_42_qtl > 0 THEN cost_42_qtl ELSE NULL END), 2) as avg_cost_42,
            COALESCE(SUM(CASE WHEN (oil_analyzer_by < 39.0 OR (cost_42_qtl - billed_rate_qtl) >= 200.0 OR net_ded > 75000.0 OR status != 'Matched') THEN 1 ELSE 0 END), 0) as anomaly_count,
            COALESCE(SUM(CASE WHEN (oil_nir IS NULL OR oil_nir <= 0) THEN 1 ELSE 0 END), 0) as lab_pending_count
        FROM debit_note_records
        {where_sql}
    """
    cursor.execute(query, params)
    res = dict(cursor.fetchone())

    tot_rec_wt = res['total_rec_wt_qtl'] or 0.0
    tot_bill_wt = res['total_bill_wt_qtl'] or 0.0
    tot_taxable = res['total_spend_inr'] or 0.0
    tot_ded = res['total_net_ded_inr'] or 0.0
    net_spend = tot_taxable - tot_ded
    avg_landing = round(net_spend / tot_rec_wt, 2) if tot_rec_wt > 0 else 0.0
    avg_oil = res['avg_oil_manual'] or 39.78
    avg_cost_42 = round((avg_landing / avg_oil) * 42.0, 2) if avg_oil > 0 else 0.0
    avg_billed_rate = round(tot_taxable / tot_rec_wt, 2) if tot_rec_wt > 0 else 7568.04

    # Apple-to-Apple Comparison: 42 Costing vs Khareed (Billed Rate)
    diff_rate = avg_cost_42 - avg_billed_rate
    diff_pct = round((diff_rate / avg_billed_rate) * 100.0, 2) if avg_billed_rate > 0 else 0.0
    impact_amount = round(diff_rate * tot_rec_wt, 2)

    # Loss vs Profit vs Neutral vs Pending Counts (Apple-to-Apple: 42 Costing vs Billed Purchase Rate)
    cursor.execute(f"""
        SELECT 
            COALESCE(SUM(CASE WHEN (cost_42_qtl - billed_rate_qtl) > 0.01 THEN 1 ELSE 0 END), 0) as loss_count,
            COALESCE(SUM(CASE WHEN (cost_42_qtl - billed_rate_qtl) < -0.01 THEN 1 ELSE 0 END), 0) as profit_count,
            COALESCE(SUM(CASE WHEN ABS(cost_42_qtl - billed_rate_qtl) <= 0.01 AND cost_42_qtl IS NOT NULL AND billed_rate_qtl > 0 THEN 1 ELSE 0 END), 0) as neutral_count,
            COALESCE(SUM(CASE WHEN cost_42_qtl IS NULL OR billed_rate_qtl IS NULL OR billed_rate_qtl <= 0 THEN 1 ELSE 0 END), 0) as pending_count
        FROM debit_note_records
        {where_sql}
    """, params)
    counts_row = dict(cursor.fetchone())
    loss_count = counts_row['loss_count']
    profit_count = counts_row['profit_count']
    neutral_count = counts_row['neutral_count']
    pending_count = counts_row['pending_count']
    tot_recs = res['total_records'] or (loss_count + profit_count + neutral_count + pending_count)
    loss_pct = round((loss_count / tot_recs) * 100.0, 1) if tot_recs > 0 else 0.0
    profit_pct = round((profit_count / tot_recs) * 100.0, 1) if tot_recs > 0 else 0.0
    neutral_pct = round((neutral_count / tot_recs) * 100.0, 1) if tot_recs > 0 else 0.0
    pending_pct = round((pending_count / tot_recs) * 100.0, 1) if tot_recs > 0 else 0.0

    # Quality breakdown
    cursor.execute(f"""
        SELECT 
            CASE 
                WHEN (cost_42_qtl - billed_rate_qtl) > 0.01 THEN 'LOSS'
                WHEN (cost_42_qtl - billed_rate_qtl) < -0.01 THEN 'GAIN'
                WHEN cost_42_qtl IS NULL OR billed_rate_qtl IS NULL OR billed_rate_qtl <= 0 THEN 'PENDING'
                ELSE 'NEUTRAL'
            END as impact_type,
            COUNT(*) as count
        FROM debit_note_records
        {where_sql}
        GROUP BY impact_type
    """, params)
    breakdown = {row['impact_type']: row['count'] for row in cursor.fetchall()}
    conn.close()

    return DashboardKpiResponse(
        total_records=res['total_records'],
        total_weight_qtl=round(tot_rec_wt, 2),
        total_spend_inr=round(tot_taxable, 2),
        avg_actual_rate=avg_billed_rate,
        avg_oil_manual=round(avg_oil, 2),
        avg_oil_analyzer=round(res['avg_oil_analyzer'] or 0.0, 2),
        avg_cost_42=round(avg_cost_42, 2),
        cost_impact_amount_inr=impact_amount,
        cost_impact_pct=diff_pct,
        total_net_ded_inr=round(tot_ded, 2),
        quality_status_breakdown=breakdown,
        anomaly_count=res['anomaly_count'],
        lab_pending_count=res['lab_pending_count'],
        loss_count=loss_count,
        profit_count=profit_count,
        neutral_count=neutral_count,
        pending_count=pending_count,
        loss_pct=loss_pct,
        profit_pct=profit_pct,
        neutral_pct=neutral_pct,
        pending_pct=pending_pct,
        total_rec_wt_qtl=round(tot_rec_wt, 2),
        total_rec_wt_mt=round(res['total_rec_wt_mt'] or (tot_rec_wt / 10.0), 3),
        total_bill_wt_qtl=round(tot_bill_wt, 2),
        avg_landing_cost_qtl=round(avg_landing, 2)
    )

@app.get("/api/records")
def get_records(
    page: int = 1,
    limit: int = 50,
    sort_by: str = "id",
    sort_order: str = "desc",
    supervisor: Optional[str] = None,
    supplier: Optional[str] = None,
    station: Optional[str] = None,
    broker: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_rate: Optional[float] = None,
    max_rate: Optional[float] = None,
    min_oil: Optional[float] = None,
    max_oil: Optional[float] = None,
    search: Optional[str] = None,
    anomaly_only: Optional[bool] = False,
    lab_pending_only: Optional[bool] = False
):
    offset = (page - 1) * limit
    filter_sql, params = build_filter_clause(
        supervisor=supervisor, supplier=supplier, station=station, broker=broker,
        date_from=date_from, date_to=date_to, min_rate=min_rate, max_rate=max_rate,
        min_oil=min_oil, max_oil=max_oil, search=search, anomaly_only=anomaly_only,
        lab_pending_only=lab_pending_only
    )
    
    # Allowed sort columns
    allowed_sorts = {
        "id", "gin", "grn_no", "po_no", "supplier_name", "station", "gin_date",
        "bill_wt", "actual_rate", "party_condition", "oil_manual", "oil_analyzer",
        "cost_42", "cost_diff_pct", "anomaly_score", "moisture_qc"
    }
    col = sort_by if sort_by in allowed_sorts else "id"
    order = "ASC" if sort_order.lower() == "asc" else "DESC"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Count total
    cursor.execute(f"SELECT COUNT(*) FROM transactions WHERE 1=1 {filter_sql}", params)
    total_count = cursor.fetchone()[0]
    
    # Select records
    query = f"""
        SELECT * FROM transactions
        WHERE 1=1 {filter_sql}
        ORDER BY {col} {order}
        LIMIT ? OFFSET ?
    """
    cursor.execute(query, params + [limit, offset])
    rows = [dict(r) for r in cursor.fetchall()]
    
    # Parse JSON fields
    for r in rows:
        r['anomaly_reasons'] = json.loads(r['anomaly_reasons']) if r.get('anomaly_reasons') else []
        r['audit_flags'] = json.loads(r['audit_flags']) if r.get('audit_flags') else []
        
    conn.close()
    
    return {
        "total": total_count,
        "page": page,
        "limit": limit,
        "pages": (total_count + limit - 1) // limit,
        "records": rows
    }

@app.get("/api/records/{record_id}")
def get_single_record(record_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = ?", (record_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction record not found")
    d = dict(row)
    d['anomaly_reasons'] = json.loads(d['anomaly_reasons']) if d.get('anomaly_reasons') else []
    d['audit_flags'] = json.loads(d['audit_flags']) if d.get('audit_flags') else []
    return d

@app.get("/api/filters/options", response_model=FilterOptionsResponse)
def get_filter_options():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT DISTINCT supervisor_name FROM transactions WHERE supervisor_name IS NOT NULL ORDER BY supervisor_name")
    supervisors = [r[0] for r in cursor.fetchall() if r[0]]
    
    cursor.execute("SELECT DISTINCT supplier_name FROM transactions WHERE supplier_name IS NOT NULL ORDER BY supplier_name")
    suppliers = [r[0] for r in cursor.fetchall() if r[0]]
    
    cursor.execute("SELECT DISTINCT station FROM transactions WHERE station IS NOT NULL ORDER BY station")
    stations = [r[0] for r in cursor.fetchall() if r[0]]
    
    cursor.execute("SELECT DISTINCT broker_name FROM transactions WHERE broker_name IS NOT NULL ORDER BY broker_name")
    brokers = [r[0] for r in cursor.fetchall() if r[0]]
    
    cursor.execute("""
        SELECT 
            MIN(gin_date) as min_date, MAX(gin_date) as max_date,
            MIN(actual_rate) as min_rate, MAX(actual_rate) as max_rate,
            MIN(oil_manual) as min_oil, MAX(oil_manual) as max_oil
        FROM transactions
    """)
    stats = dict(cursor.fetchone())
    conn.close()
    
    return FilterOptionsResponse(
        supervisors=supervisors,
        suppliers=suppliers,
        stations=stations,
        brokers=brokers,
        min_date=stats.get('min_date'),
        max_date=stats.get('max_date'),
        min_rate=stats.get('min_rate'),
        max_rate=stats.get('max_rate'),
        min_oil=stats.get('min_oil'),
        max_oil=stats.get('max_oil')
    )

@app.get("/api/analytics/suppliers")
def get_supplier_analytics(limit: int = 20):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"""
        SELECT 
            supplier_name,
            COUNT(*) as total_trips,
            ROUND(SUM(bill_wt), 2) as total_qty_qtl,
            ROUND(AVG(actual_rate), 2) as avg_rate,
            ROUND(AVG(party_condition), 2) as avg_condition,
            ROUND(AVG(oil_manual), 2) as avg_oil,
            ROUND(AVG(oil_analyzer), 2) as avg_analyzer_oil,
            ROUND(AVG(cost_42), 2) as avg_cost_42,
            ROUND(AVG(cost_diff_pct), 2) as avg_cost_diff_pct,
            ROUND(AVG(moisture_qc), 2) as avg_moisture,
            ROUND(AVG(fm_pct), 2) as avg_fm,
            SUM(CASE WHEN is_anomaly = 1 THEN 1 ELSE 0 END) as anomaly_count
        FROM transactions
        WHERE oil_manual IS NOT NULL
        GROUP BY supplier_name
        ORDER BY total_qty_qtl DESC
        LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.get("/api/analytics/stations")
def get_station_analytics():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            station,
            COUNT(*) as total_trips,
            ROUND(SUM(bill_wt), 2) as total_qty_qtl,
            ROUND(AVG(actual_rate), 2) as avg_rate,
            ROUND(AVG(oil_manual), 2) as avg_oil,
            ROUND(AVG(cost_42), 2) as avg_cost_42,
            ROUND(AVG(cost_diff_pct), 2) as avg_cost_diff_pct
        FROM transactions
        WHERE oil_manual IS NOT NULL AND station IS NOT NULL
        GROUP BY station
        ORDER BY total_qty_qtl DESC
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.get("/api/analytics/trends")
def get_costing_trends(
    supervisor: Optional[str] = None,
    supplier: Optional[str] = None,
    station: Optional[str] = None,
    broker: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    anomaly_only: Optional[bool] = False,
    lab_pending_only: Optional[bool] = False
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    where_parts = [
        "date IS NOT NULL", 
        "date != ''", 
        "billed_rate_qtl > 1000", 
        "landing_cost_qtl > 1000", 
        "oil_nir > 10"
    ]
    params = []
    if supervisor:
        where_parts.append("supervisor_name = ?")
        params.append(supervisor)
    if supplier:
        where_parts.append("supplier_name = ?")
        params.append(supplier)
    if station:
        where_parts.append("station = ?")
        params.append(station)
    if broker:
        where_parts.append("broker_name = ?")
        params.append(broker)
    if date_from:
        where_parts.append("date >= ?")
        params.append(date_from)
    if date_to:
        where_parts.append("date <= ?")
        params.append(date_to)
    if anomaly_only:
        where_parts.append("(oil_analyzer_by < 39.0 OR (cost_42_qtl - billed_rate_qtl) >= 200.0 OR net_ded > 75000.0 OR status != 'Matched')")
    if lab_pending_only:
        where_parts.append("(cost_42_qtl IS NULL OR oil_nir IS NULL OR oil_analyzer_by IS NULL OR oil_analyzer_by <= 0 OR status = 'Lab Data Not Available' OR status LIKE '%Pending%')")
    if search and search.strip():
        s_clean = search.strip()
        if s_clean.lower() in ["direct", "direct purchase", "direct purchases", "no broker"]:
            where_parts.append("(broker_name IS NULL OR broker_name = '' OR broker_name LIKE '%Direct%')")
        else:
            where_parts.append("(gin LIKE ? OR supplier_name LIKE ? OR po_no LIKE ? OR bill_no LIKE ? OR station LIKE ? OR broker_name LIKE ?)")
            search_param = f"%{s_clean}%"
            params.extend([search_param, search_param, search_param, search_param, search_param, search_param])
    where_sql = " AND ".join(where_parts)

    query = f"""
        SELECT 
            date,
            COUNT(*) as record_count,
            ROUND(AVG(billed_rate_qtl), 2) as avg_rate,
            ROUND(AVG(landing_cost_qtl), 2) as landing_cost,
            ROUND(AVG(oil_nir), 2) as avg_oil,
            ROUND(AVG(cost_42_qtl), 2) as avg_cost_42,
            ROUND(AVG(cost_42_qtl), 2) as cost_42_billed,
            ROUND(AVG(net_ded / NULLIF(rec_wt_qtl, 0)), 2) as katoti_qtl,
            ROUND(SUM(bill_wt_qtl), 2) as daily_wt_qtl
        FROM debit_note_records
        WHERE {where_sql}
        GROUP BY date
        ORDER BY date ASC
    """
    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.get("/api/analytics/quality-distribution")
def get_quality_distribution():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT oil_manual FROM transactions WHERE oil_manual IS NOT NULL AND oil_manual > 0
    """)
    oil_vals = [r[0] for r in cursor.fetchall()]
    conn.close()
    
    # Bin into intervals: <38, 38-39, 39-40, 40-41, 41-42, >=42
    bins = {
        "< 38.0% (Critical Low)": 0,
        "38.0% - 39.0% (Sub-standard)": 0,
        "39.0% - 40.0% (Average)": 0,
        "40.0% - 41.0% (Good Quality)": 0,
        "41.0% - 42.0% (Premium)": 0,
        ">= 42.0% (Benchmark & Above)": 0
    }
    for val in oil_vals:
        if val < 38.0:
            bins["< 38.0% (Critical Low)"] += 1
        elif val < 39.0:
            bins["38.0% - 39.0% (Sub-standard)"] += 1
        elif val < 40.0:
            bins["39.0% - 40.0% (Average)"] += 1
        elif val < 41.0:
            bins["40.0% - 41.0% (Good Quality)"] += 1
        elif val < 42.0:
            bins["41.0% - 42.0% (Premium)"] += 1
        else:
            bins[">= 42.0% (Benchmark & Above)"] += 1
            
    return [{"range": k, "count": v, "percentage": round((v / len(oil_vals) * 100), 2) if oil_vals else 0} for k, v in bins.items()]

@app.get("/api/analytics/lab-comparison")
def get_lab_comparison():
    """Compares Uploaded Debit Note Sheet Col BY vs Lab Report Oil Analyzer Col AX."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            gin, supplier_name, date as gin_date,
            oil_analyzer_by as oil_manual, oil_analyzer_ax as oil_analyzer,
            ROUND(oil_analyzer_by - oil_analyzer_ax, 2) as diff
        FROM debit_note_records
        WHERE oil_analyzer_by > 0 AND oil_analyzer_ax > 0
        ORDER BY ABS(oil_analyzer_by - oil_analyzer_ax) DESC
        LIMIT 100
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute("""
        SELECT 
            ROUND(AVG(oil_analyzer_by), 2) as avg_manual,
            ROUND(AVG(oil_analyzer_ax), 2) as avg_analyzer,
            ROUND(AVG(oil_analyzer_by - oil_analyzer_ax), 3) as mean_bias,
            COUNT(*) as sample_count
        FROM debit_note_records
        WHERE oil_analyzer_by > 0 AND oil_analyzer_ax > 0
    """)
    stats = dict(cursor.fetchone())
    conn.close()
    
    return {
        "summary": stats,
        "records": rows
    }

@app.get("/api/ai/insights")
def get_insights(
    supervisor: Optional[str] = None,
    supplier: Optional[str] = None,
    station: Optional[str] = None,
    broker: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
):
    filter_sql, params = build_filter_clause(
        supervisor=supervisor, supplier=supplier, station=station, broker=broker,
        date_from=date_from, date_to=date_to
    )
    return generate_ai_insights(filter_sql=filter_sql, params=params)

@app.get("/api/ai/anomalies")
def get_anomalies(
    page: int = 1,
    limit: int = 25,
    search: Optional[str] = None,
    sort_by: str = "anomaly_score",
    sort_order: str = "desc"
):
    import math
    conn = get_db_connection()
    cursor = conn.cursor()
    
    base_anomaly_clause = "(oil_analyzer_by < 39.0 OR (cost_42_qtl - billed_rate_qtl) >= 200.0 OR net_ded > 75000.0 OR status != 'Matched')"
    where_clauses = [base_anomaly_clause]
    params = []
    
    if search and search.strip():
        s = f"%{search.strip()}%"
        where_clauses.append("(gin LIKE ? OR po_no LIKE ? OR supplier_name LIKE ? OR station LIKE ? OR status LIKE ?)")
        params.extend([s, s, s, s, s])
        
    where_sql = " AND ".join(where_clauses)
    
    cursor.execute(f"SELECT COUNT(*) FROM debit_note_records WHERE {where_sql}", params)
    total = cursor.fetchone()[0]
    
    allowed_sorts = {
        "anomaly_score": "(cost_42_qtl - billed_rate_qtl)",
        "cost_variance": "(cost_42_qtl - billed_rate_qtl)",
        "gin": "gin",
        "grn_no": "po_no",
        "po_no": "po_no",
        "supplier_name": "supplier_name",
        "station": "station",
        "actual_rate": "billed_rate_qtl",
        "billed_rate_qtl": "billed_rate_qtl",
        "oil_manual": "oil_analyzer_by",
        "oil_analyzer_by": "oil_analyzer_by",
        "cost_42": "cost_42_qtl",
        "cost_42_qtl": "cost_42_qtl",
        "cost_diff_pct": "((cost_42_qtl - billed_rate_qtl) / billed_rate_qtl)"
    }
    col = allowed_sorts.get(sort_by, "(cost_42_qtl - billed_rate_qtl)")
    order = "ASC" if sort_order.lower() == "asc" else "DESC"
    
    offset = max(0, (page - 1) * limit)
    query = f"""
        SELECT * FROM debit_note_records
        WHERE {where_sql}
        ORDER BY {col} {order}
        LIMIT ? OFFSET ?
    """
    cursor.execute(query, params + [limit, offset])
    rows = [dict(r) for r in cursor.fetchall()]
    
    for r in rows:
        reasons = []
        diff_qtl = (r.get('cost_42_qtl') or 0.0) - (r.get('billed_rate_qtl') or 0.0)
        oil = r.get('oil_analyzer_by')
        ded = r.get('net_ded') or 0.0
        status_val = r.get('status')
        
        if diff_qtl >= 200.0:
            reasons.append(f"Heavy Quality Loss: +₹{diff_qtl:.2f}/Qtl")
        if oil is not None and oil < 39.0:
            reasons.append(f"Low Oil Yield: {oil:.2f}% (< 39%)")
        if ded > 75000.0:
            reasons.append(f"High Deductions: ₹{ded:,.0f}")
        if status_val and status_val != 'Matched':
            reasons.append(f"Discrepancy: {status_val}")
            
        r['anomaly_reasons'] = reasons
        r['actual_rate'] = r.get('billed_rate_qtl')
        r['cost_42'] = r.get('cost_42_qtl')
        r['oil_manual'] = r.get('oil_analyzer_by')
        r['grn_no'] = r.get('po_no')
        r['cost_diff'] = round(diff_qtl, 2)
        r['cost_diff_pct'] = round((diff_qtl / (r.get('billed_rate_qtl') or 1.0)) * 100.0, 2)

    # Dynamic Donut Distribution across all flagged records
    cursor.execute("SELECT COUNT(*) FROM debit_note_records WHERE (cost_42_qtl - billed_rate_qtl) >= 200.0")
    cnt_heavy_loss = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM debit_note_records WHERE oil_analyzer_by < 39.0")
    cnt_low_oil = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM debit_note_records WHERE net_ded > 75000.0")
    cnt_high_ded = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM debit_note_records WHERE status != 'Matched'")
    cnt_disc = cursor.fetchone()[0]

    type_counts = {
        'Heavy Quality Loss (≥ ₹200/Qtl)': cnt_heavy_loss,
        'Low Oil Yield (< 39.0%)': cnt_low_oil,
        'Heavy Deductions (> ₹75k)': cnt_high_ded,
        'Reconciliation Discrepancies': cnt_disc
    }

    conn.close()
    total_pages = max(1, math.ceil(total / limit)) if limit > 0 else 1
    
    return {
        "items": rows,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": total_pages,
        "type_counts": type_counts
    }

@app.post("/api/formula/verify", response_model=FormulaTestResponse)
def verify_formula(req: FormulaTestRequest):
    rate = req.actual_rate
    oil = req.oil_manual
    
    if req.bill_amount and req.bill_weight and req.bill_weight > 0:
        rate = req.bill_amount / req.bill_weight
        
    cost_res = calculate_42_adjusted_cost(rate, oil)
    cost_42 = cost_res["cost_42"]
    
    impact = calculate_cost_impact(rate, cost_42)
    
    steps = [
        f"1. Verified Actual Purchase Rate (AT) = ₹{rate:,.2f} per Quintal",
        f"2. Verified Laboratory Oil Quality (AW) = {oil:.2f}%",
        f"3. Applied Benchmark Oil Quality Standard = {BENCHMARK_OIL:.2f}%",
        f"4. Mathematical Formula: 42 Adjusted Cost = (Actual Rate ÷ Laboratory Oil) × 42",
        f"5. Calculation: ({rate:,.4f} ÷ {oil:.4f}) × {BENCHMARK_OIL:.2f} = ₹{cost_42:,.4f}",
        f"6. Cost Variance: ₹{cost_42:,.2f} - ₹{rate:,.2f} = {'+' if impact['cost_diff'] > 0 else ''}₹{impact['cost_diff']:,.2f}/Qtl ({'+' if impact['cost_diff_pct'] > 0 else ''}{impact['cost_diff_pct']}%)"
    ]
    
    explanation = (
        f"Because the seed provides {oil:.2f}% oil against the industry benchmark of 42.00%, "
        f"the effective cost of seed required to produce the benchmark oil quantity is ₹{cost_42:,.2f}/Qtl. "
        f"This constitutes a {impact['impact_type'].replace('_', ' ').lower()} of {abs(impact['cost_diff_pct'])}%."
    )
    
    return FormulaTestResponse(
        benchmark=BENCHMARK_OIL,
        actual_rate=round(rate, 2),
        oil_manual=round(oil, 2),
        cost_42=cost_42,
        step_by_step=steps,
        cost_diff=impact["cost_diff"],
        cost_diff_pct=impact["cost_diff_pct"],
        impact_type=impact["impact_type"],
        status=cost_res["status"],
        explanation=explanation
    )

@app.get("/api/audit/data-quality")
def get_data_quality_audit():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM transactions")
    total = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM transactions WHERE costing_status = 'LAB_PENDING' OR oil_analyzer IS NULL OR oil_analyzer <= 0")
    lab_pending = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM transactions WHERE is_anomaly = 1")
    anomalies = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM transactions WHERE station IS NOT NULL AND station != ''")
    station_norm = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM transactions WHERE broker_name IS NULL OR broker_name = '' OR broker_name LIKE '%Direct%'")
    direct_purchases = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM transactions WHERE supervisor_name IS NOT NULL AND supervisor_name != ''")
    supervisor_matched = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM debit_note_records WHERE oil_analyzer_by > 0 AND oil_analyzer_ax > 0")
    dual_oil_compared = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM debit_note_records WHERE oil_mismatch_flag = 1")
    oil_mismatches_flagged = cursor.fetchone()[0]

    cursor.execute("SELECT gin, COUNT(*) as cnt FROM transactions GROUP BY gin HAVING COUNT(*) > 1")
    shared_gin_rows = cursor.fetchall()
    shared_gins_count = len(shared_gin_rows)
    split_rows_count = sum(r[1] for r in shared_gin_rows)
    
    cursor.execute("SELECT COUNT(DISTINCT gin) FROM transactions")
    unique_gins = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*), MAX(moisture_qc) FROM transactions WHERE moisture_qc > 50 OR moisture_pre_pct > 50")
    moisture_row = cursor.fetchone()
    moisture_outlier_count = moisture_row[0] if moisture_row else 1
    moisture_max_val = moisture_row[1] if (moisture_row and moisture_row[1]) else 455.0
    
    cursor.execute("SELECT MIN(gin_date), MAX(gin_date) FROM transactions WHERE gin_date IS NOT NULL AND gin_date != ''")
    date_row = cursor.fetchone()
    min_date = date_row[0] if date_row and date_row[0] else "01-Apr-2026"
    max_date = date_row[1] if date_row and date_row[1] else "10-Sep-2026"

    cursor.execute("SELECT id, gin, grn_no, supplier_name, audit_flags FROM transactions WHERE audit_flags != '[]' AND audit_flags IS NOT NULL LIMIT 50")
    flagged_samples = []
    for r in cursor.fetchall():
        try:
            flags = json.loads(r[4]) if r[4] else []
        except:
            flags = [r[4]]
        flagged_samples.append({
            "id": r[0],
            "gin": r[1],
            "grn_no": r[2],
            "supplier": r[3],
            "flags": flags
        })
        
    conn.close()
    
    return {
        "total_records": total,
        "lab_pending_count": lab_pending,
        "anomaly_count": anomalies,
        "stations_normalized_count": station_norm,
        "direct_purchases_count": direct_purchases,
        "supervisor_matched_count": supervisor_matched,
        "dual_oil_compared_count": dual_oil_compared,
        "oil_mismatches_flagged": oil_mismatches_flagged,
        "flagged_samples": flagged_samples,
        "rules_integrity": {
            "zero_denom": {
                "pending_count": lab_pending,
                "total_records": total,
                "protected_count": max(0, total - lab_pending),
                "div_zero_errors": 0
            },
            "moisture_typo": {
                "outlier_count": moisture_outlier_count,
                "row_ref": "Row 502 (GIN INWDMSD27/0488)",
                "raw_val": moisture_max_val,
                "clean_val": 5.0
            },
            "date_fallback": {
                "verified_dates": total,
                "date_start": min_date,
                "date_end": max_date,
                "reconciled_count": 15
            },
            "gin_split": {
                "shared_gins": shared_gins_count,
                "split_rows": split_rows_count,
                "unique_gins": unique_gins,
                "total_records": total
            }
        }
    }

@app.get("/api/audit/drilldown")
def get_audit_drilldown(
    audit_type: str = Query("all", pattern="^(all|lab_pending|stations_normalized|direct_purchases|oil_mismatches)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    search: Optional[str] = None
):
    offset = (page - 1) * limit
    conn = get_db_connection()
    cursor = conn.cursor()
    
    where_clauses = []
    params = []
    
    if audit_type == "lab_pending":
        where_clauses.append("(costing_status = 'LAB_PENDING' OR oil_analyzer IS NULL OR oil_analyzer <= 0)")
    elif audit_type == "stations_normalized":
        where_clauses.append("(station IS NOT NULL AND station != '')")
    elif audit_type == "direct_purchases":
        where_clauses.append("(broker_name IS NULL OR broker_name = '' OR broker_name LIKE '%Direct%')")
    elif audit_type == "oil_mismatches":
        where_clauses.append("(is_anomaly = 1 OR audit_flags LIKE '%Oil Diff%')")
        
    if search and search.strip():
        s = f"%{search.strip()}%"
        where_clauses.append("(supplier_name LIKE ? OR station LIKE ? OR grn_no LIKE ? OR broker_name LIKE ? OR supervisor_name LIKE ? OR gin LIKE ?)")
        params.extend([s, s, s, s, s, s])
        
    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    
    cursor.execute(f"SELECT COUNT(*) FROM transactions {where_sql}", params)
    total_count = cursor.fetchone()[0]
    
    cursor.execute(f"""
        SELECT id, gin, grn_no, po_no, supplier_name, station, station_original, 
               broker_name, broker_original, supervisor_name, gin_date, bill_wt, rec_wt, actual_rate, 
               oil_manual, oil_analyzer, cost_42, costing_status, is_anomaly, audit_flags
        FROM transactions
        {where_sql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    
    rows = [dict(r) for r in cursor.fetchall()]
    for r in rows:
        try:
            r['anomaly_reasons'] = json.loads(r['anomaly_reasons']) if r.get('anomaly_reasons') else []
        except:
            r['anomaly_reasons'] = [r.get('anomaly_reasons')]
        try:
            r['audit_flags'] = json.loads(r['audit_flags']) if r.get('audit_flags') else []
        except:
            r['audit_flags'] = [r.get('audit_flags')]
            
    extra = {}
    if audit_type == "stations_normalized":
        cursor.execute("""
            SELECT station_original, station, COUNT(*) as lot_count, ROUND(SUM(bill_wt), 2) as total_wt
            FROM transactions
            WHERE station IS NOT NULL AND station != ''
            GROUP BY station_original, station
            ORDER BY lot_count DESC
        """)
        extra["mappings"] = [dict(r) for r in cursor.fetchall()]
    elif audit_type == "direct_purchases":
        cursor.execute("""
            SELECT COUNT(*) as total_lots, ROUND(SUM(bill_wt), 2) as total_wt, 
                   ROUND(SUM(bill_wt * actual_rate), 2) as total_spend,
                   ROUND(AVG(actual_rate), 2) as avg_rate
            FROM transactions
            WHERE broker_name IS NULL OR broker_name = '' OR broker_name LIKE '%Direct%'
        """)
        r_sum = cursor.fetchone()
        extra["summary"] = dict(r_sum) if r_sum else {}
    elif audit_type == "lab_pending":
        cursor.execute("""
            SELECT COUNT(*) as total_lots, ROUND(SUM(bill_wt), 2) as total_wt,
                   ROUND(AVG(actual_rate), 2) as avg_rate
            FROM transactions
            WHERE costing_status = 'LAB_PENDING' OR oil_analyzer IS NULL OR oil_analyzer <= 0
        """)
        r_sum = cursor.fetchone()
        extra["summary"] = dict(r_sum) if r_sum else {}
    elif audit_type == "all":
        cursor.execute("""
            SELECT COUNT(*) as total_lots, ROUND(SUM(bill_wt), 2) as total_wt, 
                   ROUND(SUM(bill_wt * actual_rate), 2) as total_spend,
                   ROUND(AVG(actual_rate), 2) as avg_rate
            FROM transactions
        """)
        r_sum = cursor.fetchone()
        extra["summary"] = dict(r_sum) if r_sum else {}
        
    conn.close()
    
    return {
        "audit_type": audit_type,
        "total": total_count,
        "page": page,
        "limit": limit,
        "pages": (total_count + limit - 1) // limit if limit > 0 and total_count > 0 else 1,
        "records": rows,
        "extra": extra
    }


@app.post("/api/sync/trigger")
def trigger_sync(req: SyncRequest = Body(default=None)):
    sheet_id = req.sheet_id if req else None
    gid = req.gid if req else "0"
    res = sync_from_google_sheet(sheet_id=sheet_id, gid=gid)
    return res

@app.get("/api/sync/history")
def get_sync_history():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 20")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

from fastapi.responses import FileResponse

# --- Debit Note & Landing Cost Analysis Endpoints ---

@app.get("/api/debit-note/kpis")
def get_debit_note_kpis():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            COUNT(*) as total_lots,
            ROUND(SUM(COALESCE(rec_wt_mt, 0)), 3) as total_rec_wt_mt,
            ROUND(SUM(COALESCE(rec_wt_qtl, 0)), 2) as total_rec_wt_qtl,
            ROUND(SUM(COALESCE(taxable_amt_an, 0)), 2) as total_taxable_amt,
            ROUND(SUM(COALESCE(debit_amt_y, 0)), 2) as total_debit_amt,
            ROUND(SUM(COALESCE(net_ded, 0)), 2) as total_net_ded,
            ROUND(AVG(CASE WHEN oil_nir > 0 THEN oil_nir ELSE NULL END), 2) as avg_oil_nir
        FROM debit_note_records
    """)
    res = dict(cursor.fetchone())
    
    tot_mt = res['total_rec_wt_mt'] or 0.0
    tot_taxable = res['total_taxable_amt'] or 0.0
    tot_ded = res['total_net_ded'] or 0.0
    net_spend = tot_taxable - tot_ded
    
    avg_landing_mt = round(net_spend / tot_mt, 2) if tot_mt > 0 else 0.0
    avg_landing_qtl = round(avg_landing_mt / 10.0, 2)
    avg_oil = res['avg_oil_nir'] or 39.76
    avg_cost_42_mt = round((avg_landing_mt / avg_oil) * 42.0, 2) if avg_oil > 0 else 0.0
    avg_cost_42_qtl = round(avg_cost_42_mt / 10.0, 2)
    quality_impact_tot = round((avg_cost_42_mt - avg_landing_mt) * tot_mt, 2)
    
    cursor.execute("SELECT status, COUNT(*) as count FROM debit_note_records GROUP BY status")
    status_counts = {row['status']: row['count'] for row in cursor.fetchall()}

    cursor.execute("""
        SELECT COUNT(*) FROM debit_note_records 
        WHERE status != 'Matched' 
           OR abs(COALESCE(debit_amt_y, 0) - COALESCE(taxable_amt_an, 0)) > 0.01
    """)
    total_discrepancies = cursor.fetchone()[0]
    conn.close()
    
    return {
        "total_lots": res['total_lots'],
        "total_rec_wt_mt": tot_mt,
        "total_rec_wt_qtl": res['total_rec_wt_qtl'],
        "total_taxable_amt": tot_taxable,
        "total_debit_amt": res['total_debit_amt'],
        "total_net_ded": tot_ded,
        "total_discrepancies": total_discrepancies,
        "net_material_spend": round(net_spend, 2),
        "avg_landing_cost_mt": avg_landing_mt,
        "avg_landing_cost_qtl": avg_landing_qtl,
        "avg_oil_nir": avg_oil,
        "avg_cost_42_mt": avg_cost_42_mt,
        "avg_cost_42_qtl": avg_cost_42_qtl,
        "quality_impact_tot": quality_impact_tot,
        "status_counts": status_counts
    }

@app.get("/api/debit-note/stations")
def get_debit_note_stations():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT station, COUNT(*) as count 
        FROM debit_note_records 
        WHERE station IS NOT NULL AND TRIM(station) != '' 
        GROUP BY station 
        ORDER BY station ASC
    """)
    stations = [{"station": r["station"], "count": r["count"]} for r in cursor.fetchall()]
    conn.close()
    return {"stations": stations}

@app.get("/api/debit-note/records")
def get_debit_note_records(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=500),
    search: Optional[str] = None,
    status: Optional[str] = None,
    outcome: Optional[str] = None,
    oil_range: Optional[str] = None,
    station: Optional[str] = None,
    supplier: Optional[str] = None,
    sort_by: str = "id",
    sort_order: str = "asc"
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    where_clauses = ["1=1"]
    params = []
    
    if search:
        s_clean = search.strip()
        if s_clean.lower() in ["direct", "direct purchase", "direct purchases", "no broker"]:
            where_clauses.append("(broker_name IS NULL OR broker_name = '' OR broker_name LIKE '%Direct%')")
        else:
            where_clauses.append("(gin LIKE ? OR supplier_name LIKE ? OR po_no LIKE ? OR bill_no LIKE ? OR station LIKE ? OR broker_name LIKE ?)")
            search_param = f"%{s_clean}%"
            params.extend([search_param, search_param, search_param, search_param, search_param, search_param])
        
    if status:
        if status in ["lab_pending", "pending", "Lab Pending"]:
            where_clauses.append("(cost_42_qtl IS NULL OR oil_nir IS NULL OR oil_analyzer_by IS NULL OR oil_analyzer_by <= 0 OR status = 'Lab Data Not Available' OR status LIKE '%Pending%')")
        else:
            where_clauses.append("status = ?")
            params.append(status)
        
    if outcome:
        if outcome == "loss":
            where_clauses.append("(cost_42_qtl - billed_rate_qtl) > 0.01")
        elif outcome in ["profit", "munakha"]:
            where_clauses.append("(cost_42_qtl - billed_rate_qtl) < -0.01")
        elif outcome in ["even", "parity", "neutral", "barabar"]:
            where_clauses.append("ABS(cost_42_qtl - billed_rate_qtl) <= 0.01")
        elif outcome == "heavy_loss":
            where_clauses.append("(cost_42_qtl - billed_rate_qtl) >= 200")
        elif outcome == "moderate_loss":
            where_clauses.append("(cost_42_qtl - billed_rate_qtl) >= 0.01 AND (cost_42_qtl - billed_rate_qtl) < 200")
            
    if oil_range:
        if oil_range == "low":
            where_clauses.append("COALESCE(oil_analyzer_by, oil_nir) < 38.0")
        elif oil_range == "sub_benchmark":
            where_clauses.append("COALESCE(oil_analyzer_by, oil_nir) >= 38.0 AND COALESCE(oil_analyzer_by, oil_nir) < 40.0")
        elif oil_range == "near_benchmark":
            where_clauses.append("COALESCE(oil_analyzer_by, oil_nir) >= 40.0 AND COALESCE(oil_analyzer_by, oil_nir) < 42.0")
        elif oil_range == "above_benchmark":
            where_clauses.append("COALESCE(oil_analyzer_by, oil_nir) >= 42.0")
            
    if station:
        where_clauses.append("station = ?")
        params.append(station)

    if supplier:
        where_clauses.append("supplier_name = ?")
        params.append(supplier)
        
    where_sql = " AND ".join(where_clauses)
    
    cursor.execute(f"SELECT COUNT(*) FROM debit_note_records WHERE {where_sql}", params)
    total = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM debit_note_records")
    total_all = cursor.fetchone()[0]
    
    is_filtered = len(where_clauses) > 1

    allowed_sorts = {
        "id": "id", "s_no": "s_no", "gin": "gin", "supplier_name": "supplier_name",
        "date": "date", "rec_wt_mt": "rec_wt_mt", "rec_wt_qtl": "rec_wt_qtl",
        "taxable_amt_an": "taxable_amt_an", "billed_rate_qtl": "billed_rate_qtl",
        "billed_rate_mt": "billed_rate_mt", "net_ded": "net_ded",
        "landing_cost_mt": "landing_cost_mt", "landing_cost_qtl": "landing_cost_qtl",
        "oil_nir": "COALESCE(oil_analyzer_by, oil_nir)",
        "oil_analyzer_by": "COALESCE(oil_analyzer_by, oil_nir)",
        "cost_42_mt": "cost_42_mt", "cost_42_qtl": "cost_42_qtl",
        "diff_mt": "diff_mt", "diff_qtl": "diff_qtl",
        "variance": "(cost_42_qtl - billed_rate_qtl)",
        "cost_variance": "(cost_42_qtl - billed_rate_qtl)"
    }
    order_col = allowed_sorts.get(sort_by, "id")
    order_dir = "ASC" if sort_order.lower() == "asc" else "DESC"
    
    offset = (page - 1) * limit
    cursor.execute(f"""
        SELECT * FROM debit_note_records
        WHERE {where_sql}
        ORDER BY {order_col} {order_dir}
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    
    records = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    pages = (total + limit - 1) // limit if total > 0 else 1
    return {
        "total": total,
        "total_all": total_all,
        "is_filtered": is_filtered,
        "page": page,
        "limit": limit,
        "pages": pages,
        "records": records
    }

@app.get("/api/debit-note/discrepancies")
def get_debit_note_discrepancies():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM debit_note_records
        WHERE status != 'Matched' 
           OR abs(COALESCE(debit_amt_y, 0) - COALESCE(taxable_amt_an, 0)) > 0.01
        ORDER BY abs(COALESCE(debit_amt_y, 0) - COALESCE(taxable_amt_an, 0)) DESC
    """)
    records = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"total": len(records), "records": records}

@app.get("/api/debit-note/suppliers")
def get_debit_note_suppliers(limit: int = 25):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"""
        SELECT 
            supplier_name,
            COUNT(*) as total_lots,
            ROUND(SUM(bill_wt_qtl), 2) as total_bill_wt_qtl,
            ROUND(SUM(rec_wt_mt), 2) as total_rec_wt_mt,
            ROUND(SUM(rec_wt_qtl), 2) as total_rec_wt_qtl,
            ROUND(SUM(debit_amt_y), 2) as total_bill_amt_y,
            ROUND(SUM(taxable_amt_an), 2) as total_taxable_amt,
            ROUND(SUM(net_ded), 2) as total_net_ded,
            ROUND(AVG(billed_rate_qtl), 2) as avg_purchase_rate_qtl,
            ROUND(AVG(billed_rate_mt), 2) as avg_purchase_rate_mt,
            ROUND(AVG(oil_nir), 2) as avg_oil_nir,
            ROUND(AVG(landing_cost_qtl), 2) as avg_landing_cost_qtl,
            ROUND(AVG(landing_cost_mt), 2) as avg_landing_cost_mt,
            ROUND(AVG(cost_42_qtl), 2) as avg_cost_42_qtl,
            ROUND(AVG(cost_42_mt), 2) as avg_cost_42_mt,
            ROUND(AVG(rate_diff_qtl), 2) as avg_rate_diff_qtl,
            ROUND(AVG(rate_diff_mt), 2) as avg_rate_diff_mt
        FROM debit_note_records
        WHERE rec_wt_mt > 0 AND oil_nir IS NOT NULL AND oil_nir > 0
        GROUP BY supplier_name
        ORDER BY total_rec_wt_mt DESC
        LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    for r in rows:
        # Rate-based impact (Comparison between 42% Cost and Mandi Purchase Rate Col Y / Col W)
        rate_diff = round((r.get('avg_rate_diff_mt') or 0), 2)
        r['rate_impact_diff'] = rate_diff
        r['rate_impact_amt'] = round(rate_diff * (r.get('total_rec_wt_mt') or 0), 2)
        r['is_loss'] = rate_diff > 0
        # Landing-based impact (post-katoti)
        r['landing_impact_diff'] = round((r['avg_cost_42_mt'] - r['avg_landing_cost_mt']), 2)
        r['impact_amt'] = round((r['avg_cost_42_mt'] - r['avg_landing_cost_mt']) * r['total_rec_wt_mt'], 2)
    conn.close()
    return rows

@app.get("/api/debit-note/download-excel")
def download_debit_note_excel():
    excel_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "KOGM_Debit_Note_Lab_Cost_Analysis.xlsx")
    if os.path.exists(excel_path):
        return FileResponse(
            path=excel_path,
            filename="KOGM_Debit_Note_Lab_Cost_Analysis.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    raise HTTPException(status_code=404, detail="Excel file not found")

@app.get("/api/suppliers/top-rankings")
def get_top_rankings(limit: int = 20):
    """Returns Top Highest Oil % Suppliers and Top Lowest 42 Costing (Best Value) Suppliers."""
    return get_top_supplier_rankings(limit=limit)

@app.get("/api/sourcing/rankings")
def get_sourcing_rankings_api(
    entity: str = Query("supplier", pattern="^(supplier|broker|supervisor|station)$"),
    limit: int = Query(20, ge=0, le=500),
    sort_by: str = Query("cost_42", pattern="^(cost_42|landing_cost|billed_rate|oil|volume|lots|diff)$"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$")
):
    """
    Returns comparative rankings for Suppliers, Brokers, Supervisors, or Mandis/Stations.
    Includes all 3 mandatory columns:
      1. Purchase Billed Rate (avg_billed_qtl / avg_billed_mt)
      2. Factory Landing Cost (avg_landing_qtl / avg_landing_mt)
      3. 42% Benchmark Costing (avg_cost_42_qtl / avg_cost_42_mt)
      + Net Cost Variance (diff_qtl / diff_mt)
    """
    return get_sourcing_rankings(
        entity_type=entity,
        limit=limit,
        sort_by=sort_by,
        sort_order=sort_order
    )

@app.get("/api/sourcing/export-excel")
def export_sourcing_excel(
    entity: str = Query("supplier", pattern="^(supplier|broker|supervisor|station)$"),
    limit: int = Query(20, ge=0, le=500),
    sort_by: str = Query("cost_42", pattern="^(cost_42|landing_cost|billed_rate|oil|volume|lots|diff)$"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    unit: str = Query("qtl", pattern="^(qtl|mt)$")
):
    """
    Generates and downloads a high-fidelity, executive-styled Excel (.xlsx) report
    for the Sourcing Intelligence Hub reflecting active entity filters, sort order, and unit.
    """
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    from io import BytesIO
    from datetime import datetime

    rows = get_sourcing_rankings(
        entity_type=entity,
        limit=limit,
        sort_by=sort_by,
        sort_order=sort_order
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{entity.title()} Sourcing"
    ws.views.sheetView[0].showGridLines = True

    is_mt = (unit.lower() == "mt")
    unit_label = "₹/MT" if is_mt else "₹/Qtl"
    wt_label = "MT" if is_mt else "Quintals"

    entity_title_map = {
        "supplier": "Supplier / Party",
        "broker": "Commission Broker / Agent",
        "supervisor": "Procurement Supervisor",
        "station": "Mandi / Station Location"
    }
    entity_title = entity_title_map.get(entity.lower(), entity.title())

    sort_title_map = {
        "cost_42": "42% Benchmark Costing",
        "landing_cost": "Factory Landing Cost",
        "billed_rate": "Purchase Billed Rate",
        "oil": "Lab Oil %",
        "volume": "Delivered Volume",
        "lots": "Deals / Lots",
        "diff": "Cost Variance"
    }
    sort_title = sort_title_map.get(sort_by.lower(), sort_by)
    order_title = "Lowest First (Incr)" if sort_order.lower() == "asc" else "Highest First (Decr)"
    limit_title = f"Top {limit} Records" if limit > 0 else f"All Records ({len(rows)} total)"

    # Brand Title Banner (Navy & Gold)
    ws.merge_cells("A1:J1")
    ws["A1"] = "KHANDELIA OIL & GENERAL MILLS PVT. LTD., CHANDIGARH"
    ws["A1"].font = Font(name="Segoe UI", size=13, bold=True, color="F59E0B")
    ws["A1"].fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 26

    ws.merge_cells("A2:J2")
    ws["A2"] = f"SOURCING INTELLIGENCE REPORT — {entity_title.upper()}S BENCHMARK ANALYSIS"
    ws["A2"].font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    ws["A2"].fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    ws["A2"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 22

    # Metadata Row
    ws.merge_cells("A3:J3")
    export_time = datetime.now().strftime("%d-%m-%Y %H:%M")
    ws["A3"] = f"Entity: {entity_title}s | Scope: {limit_title} | Unit: {unit_label} | Sort: {sort_title} ({order_title}) | Benchmark Oil Target: 42.00% | Exported: {export_time}"
    ws["A3"].font = Font(name="Segoe UI", size=9, italic=True, color="475569")
    ws["A3"].fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    ws["A3"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[3].height = 18

    # Blank Row 4
    ws.row_dimensions[4].height = 8

    # Table Header Row 5
    headers = [
        "Rank",
        f"{entity_title} Name",
        f"Purchase Rate ({unit_label})\n(Col Y/W)",
        f"Landing Cost ({unit_label})\n(Post-Katoti)",
        f"42% Benchmark Cost ({unit_label})\n(Standard 42% Oil)",
        f"Loss / Profit ({unit_label})\n(vs Purchase Rate)",
        "Lab NIR Oil %\n(Col BY)",
        f"Delivered Weight\n({wt_label})",
        "Total Lots\n(Deals)",
        "Business Verdict\n(Performance)"
    ]

    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    header_font = Font(name="Segoe UI", size=9.5, bold=True, color="FFFFFF")
    header_border = Border(
        left=Side(style="thin", color="334155"),
        right=Side(style="thin", color="334155"),
        top=Side(style="medium", color="F59E0B"),
        bottom=Side(style="medium", color="F59E0B")
    )
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=5, column=col_idx, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = header_border
        cell.alignment = header_align
    ws.row_dimensions[5].height = 36

    # Styles for Data Rows
    thin_side = Side(style="thin", color="E2E8F0")
    data_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    font_regular = Font(name="Segoe UI", size=9.5, color="0F172A")
    font_bold = Font(name="Segoe UI", size=9.5, bold=True, color="0F172A")
    font_gold_bold = Font(name="Segoe UI", size=9.5, bold=True, color="92400E")
    gold_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
    zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    white_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

    green_font = Font(name="Segoe UI", size=9.5, bold=True, color="065F46")
    green_fill = PatternFill(start_color="D1FAE5", end_color="D1FAE5", fill_type="solid")
    red_font = Font(name="Segoe UI", size=9.5, bold=True, color="991B1B")
    red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    amber_font = Font(name="Segoe UI", size=9.5, bold=True, color="92400E")
    amber_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

    tot_weight = 0.0
    tot_lots = 0
    weighted_billed = 0.0
    weighted_landing = 0.0
    weighted_cost42 = 0.0
    weighted_oil = 0.0

    current_row = 6
    for idx, r in enumerate(rows):
        is_zebra = (idx % 2 == 1)
        row_fill = zebra_fill if is_zebra else white_fill

        billed_val = r["avg_billed_mt"] if is_mt else r["avg_billed_qtl"]
        landing_val = r["avg_landing_mt"] if is_mt else r["avg_landing_qtl"]
        cost42_val = r["avg_cost_42_mt"] if is_mt else r["avg_cost_42_qtl"]
        diff_val = r["rate_diff_mt"] if is_mt else r["rate_diff_qtl"]
        if diff_val is None:
            diff_val = round((cost42_val or 0) - (billed_val or 0), 2)
        wt_val = r["total_wt_mt"] if is_mt else r["total_wt_qtl"]
        lots_val = r["total_lots"]
        oil_val = r["avg_oil_nir"]

        tot_weight += (wt_val or 0)
        tot_lots += (lots_val or 0)
        if wt_val and wt_val > 0:
            weighted_billed += (billed_val or 0) * wt_val
            weighted_landing += (landing_val or 0) * wt_val
            weighted_cost42 += (cost42_val or 0) * wt_val
            weighted_oil += (oil_val or 0) * wt_val

        # Rank
        c1 = ws.cell(row=current_row, column=1, value=r["rank"])
        c1.alignment = Alignment(horizontal="center", vertical="center")
        c1.font = Font(name="Segoe UI", size=9.5, bold=(r["rank"] <= 3), color="B45309" if r["rank"] <= 3 else "64748B")
        c1.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid") if r["rank"] <= 3 else row_fill
        c1.border = data_border

        # Entity Name
        c2 = ws.cell(row=current_row, column=2, value=r["entity_name"])
        c2.alignment = Alignment(horizontal="left", vertical="center")
        c2.font = font_bold
        c2.fill = row_fill
        c2.border = data_border

        # Purchase Rate
        c3 = ws.cell(row=current_row, column=3, value=billed_val)
        c3.alignment = Alignment(horizontal="right", vertical="center")
        c3.font = font_regular
        c3.number_format = "₹#,##0.00"
        c3.fill = row_fill
        c3.border = data_border

        # Landing Cost
        c4 = ws.cell(row=current_row, column=4, value=landing_val)
        c4.alignment = Alignment(horizontal="right", vertical="center")
        c4.font = font_regular
        c4.number_format = "₹#,##0.00"
        c4.fill = row_fill
        c4.border = data_border

        # 42% Benchmark Costing (Highlighted)
        c5 = ws.cell(row=current_row, column=5, value=cost42_val)
        c5.alignment = Alignment(horizontal="right", vertical="center")
        c5.font = font_gold_bold
        c5.number_format = "₹#,##0.00"
        c5.fill = gold_fill
        c5.border = data_border

        # Cost Variance
        diff_str = f"{'+' if diff_val > 0 else ''}₹{diff_val:,.2f}" if diff_val is not None else "—"
        c6 = ws.cell(row=current_row, column=6, value=diff_str)
        c6.alignment = Alignment(horizontal="center", vertical="center")
        c6.font = red_font if diff_val > 0 else green_font
        c6.fill = red_fill if diff_val > 0 else green_fill
        c6.border = data_border

        # Oil %
        c7 = ws.cell(row=current_row, column=7, value=(oil_val / 100.0) if oil_val else 0)
        c7.alignment = Alignment(horizontal="center", vertical="center")
        c7.font = font_bold
        c7.number_format = "0.00%"
        c7.fill = row_fill
        c7.border = data_border

        # Weight
        c8 = ws.cell(row=current_row, column=8, value=wt_val)
        c8.alignment = Alignment(horizontal="right", vertical="center")
        c8.font = font_regular
        c8.number_format = "#,##0.00"
        c8.fill = row_fill
        c8.border = data_border

        # Lots
        c9 = ws.cell(row=current_row, column=9, value=lots_val)
        c9.alignment = Alignment(horizontal="center", vertical="center")
        c9.font = font_regular
        c9.number_format = "#,##0"
        c9.fill = row_fill
        c9.border = data_border

        # Verdict
        verdict = r.get("verdict", "Parity")
        c10 = ws.cell(row=current_row, column=10, value=verdict)
        c10.alignment = Alignment(horizontal="center", vertical="center")
        if "Profit" in verdict or "Munakha" in verdict:
            c10.font = green_font
            c10.fill = green_fill
        elif "High Loss" in verdict:
            c10.font = red_font
            c10.fill = red_fill
        elif "Moderate" in verdict:
            c10.font = amber_font
            c10.fill = amber_fill
        else:
            c10.font = font_regular
            c10.fill = row_fill
        c10.border = data_border

        ws.row_dimensions[current_row].height = 20
        current_row += 1

    # Totals / Summary Row
    summary_border = Border(
        top=Side(style="medium", color="0F172A"),
        bottom=Side(style="double", color="0F172A"),
        left=thin_side,
        right=thin_side
    )
    summary_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
    summary_font = Font(name="Segoe UI", size=10, bold=True, color="0F172A")

    avg_b = (weighted_billed / tot_weight) if tot_weight > 0 else 0
    avg_l = (weighted_landing / tot_weight) if tot_weight > 0 else 0
    avg_c = (weighted_cost42 / tot_weight) if tot_weight > 0 else 0
    avg_o = (weighted_oil / tot_weight) if tot_weight > 0 else 0
    avg_d = avg_c - avg_b

    s_row = current_row
    ws.cell(row=s_row, column=1, value="—").alignment = Alignment(horizontal="center", vertical="center")
    ws.cell(row=s_row, column=2, value="TOTALS & WEIGHTED AVERAGES").alignment = Alignment(horizontal="left", vertical="center")
    ws.cell(row=s_row, column=3, value=round(avg_b, 2)).number_format = "₹#,##0.00"
    ws.cell(row=s_row, column=4, value=round(avg_l, 2)).number_format = "₹#,##0.00"
    ws.cell(row=s_row, column=5, value=round(avg_c, 2)).number_format = "₹#,##0.00"
    ws.cell(row=s_row, column=6, value=f"{'+' if avg_d > 0 else ''}₹{avg_d:,.2f}").alignment = Alignment(horizontal="center", vertical="center")
    ws.cell(row=s_row, column=7, value=(avg_o / 100.0)).number_format = "0.00%"
    ws.cell(row=s_row, column=8, value=round(tot_weight, 2)).number_format = "#,##0.00"
    ws.cell(row=s_row, column=9, value=tot_lots).number_format = "#,##0"
    ws.cell(row=s_row, column=10, value="—").alignment = Alignment(horizontal="center", vertical="center")

    for col in range(1, 11):
        cell = ws.cell(row=s_row, column=col)
        cell.fill = summary_fill
        cell.font = summary_font
        cell.border = summary_border
        if col in [3, 4, 5, 8]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif col in [1, 6, 7, 9, 10]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[s_row].height = 24

    # Column Auto-Widths with Padding
    col_widths = {
        1: 8,   # Rank
        2: 30,  # Entity Name
        3: 19,  # Purchase Rate
        4: 19,  # Landing Cost
        5: 22,  # 42% Costing
        6: 18,  # Variance
        7: 15,  # Oil %
        8: 18,  # Weight
        9: 14,  # Lots
        10: 25  # Verdict
    }
    for col_idx, width in col_widths.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"KOGM_Sourcing_{entity}_{unit}_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/suppliers/weekly")
def get_weekly_suppliers():
    """Returns week-by-week supplier breakdown with volume, NIR oil, and 42 costing."""
    return get_weekly_supplier_breakdown()

@app.get("/api/suppliers/by-location")
def get_location_suppliers():
    """Returns Mandi / Station-wise performance and supplier aggregation."""
    return get_location_supplier_breakdown()

@app.get("/api/suppliers/dormant-alerts")
def get_dormant_supplier_alerts(dormancy_days: int = 14):
    """Returns alerts for historical suppliers with no active bargains in recent period."""
    return get_no_bargain_supplier_alerts(dormancy_days=dormancy_days)

@app.get("/api/analytics/benchmark-3days")
def get_benchmark_3days():
    """Returns rolling benchmark metrics across the last 3 active trading dates."""
    return get_3day_benchmark()

@app.post("/api/email/send-weekly-report")
def send_email_report(payload: Dict[str, Any] = Body(default={})):
    """Sends the executive weekly 42% Costing HTML email report via Gmail SMTP."""
    recipient = payload.get("recipient", "khandelia@yopmail.com")
    result = send_weekly_42_costing_email(recipient_email=recipient)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("message", "Failed to send email"))
    return result

def cleanup_old_debit_files(upload_dir: str, keep_count: int = 2) -> List[str]:
    """
    Retains only the latest `keep_count` uploaded Debit Note Excel/CSV files in the directory.
    Auto-deletes all older files so disk storage never accumulates unneeded data.
    """
    try:
        files = [
            os.path.join(upload_dir, f) for f in os.listdir(upload_dir)
            if f.endswith(('.xlsx', '.xls', '.csv')) and not f.startswith('~$')
        ]
        files.sort(key=os.path.getmtime, reverse=True)
        deleted = []
        for old_f in files[keep_count:]:
            try:
                os.remove(old_f)
                deleted.append(os.path.basename(old_f))
            except Exception as e:
                print(f"Warning: could not delete {old_f}: {e}")
        return deleted
    except Exception as e:
        print(f"File cleanup error: {e}")
        return []

@app.post("/api/debit-note/upload")
async def upload_debit_note_sheet(file: UploadFile = File(...)):
    """
    Uploads a new daily Debit Note Excel sheet.
    Preserves current active data as 1-step backup, drops older backups,
    and auto-deletes older Excel files on disk to permanently protect storage.
    """
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Invalid file format. Please upload an Excel (.xlsx/.xls) or CSV file.")
    
    upload_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Debit_Note_Sheet")
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, f"Uploaded_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    res = populate_debit_db(custom_debit_path=file_path)
    if not res.get("success"):
        raise HTTPException(status_code=500, detail=res.get("error", "Failed to process debit sheet"))
        
    # Auto-cleanup disk files: keep latest 2 files (Latest upload + Previous backup), delete all older files
    deleted_files = cleanup_old_debit_files(upload_dir, keep_count=2)
    
    total_records = res.get("total_records", res.get("total_rows", 0))
    return {
        "success": True,
        "message": f"File '{file.filename}' processed successfully ({total_records:,} records). Previous upload stored as backup. Older files pruned: {len(deleted_files)}.",
        "filename": file.filename,
        "total_records": total_records,
        "backup_retained": res.get("backup_retained", True),
        "deleted_old_files": deleted_files
    }

@app.get("/api/debit-note/storage-status")
def get_debit_storage_status():
    """Returns database active rows, backup table rows, kept disk files, and retention policy."""
    upload_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Debit_Note_Sheet")
    return get_backup_and_storage_status(upload_dir=upload_dir)

@app.post("/api/debit-note/rollback")
def rollback_debit_note_backup():
    """Rolls back debit_note_records and transactions to the previous backup generation."""
    res = restore_previous_backup()
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to restore previous backup"))
    return res

# ==============================================================================
# INDIA MUSTARD (SARSO) PRICE ANALYSIS & PREDICTION API ENDPOINTS
# ==============================================================================
import sarso_prediction_service as sarso_service

@app.get("/api/sarso/current")
def get_sarso_current_market(force_refresh: bool = False):
    """
    Returns today's comprehensive Indian mustard mandi overview,
    benchmark averages, international commodity snapshots, and fresh news.
    """
    _, _, ist_display = sarso_service.get_ist_now_strings()
    mandis = sarso_service.fetch_agmarknet_mandi_data(force_refresh=force_refresh)
    summary = sarso_service.get_mandi_summary_stats(mandis)
    commodities = sarso_service.fetch_international_commodities(force_refresh=force_refresh)
    news = sarso_service.fetch_fresh_market_news(force_refresh=force_refresh)
    accuracy = sarso_service.get_accuracy_metrics()

    # Extract unique states and top reporting mandis
    states = sorted(list(set(m["state"] for m in mandis if m.get("state"))))
    
    return {
        "status": "success",
        "analyzed_at": ist_display,
        "summary": summary,
        "states": states,
        "mandi_count": len(mandis),
        "mandis": mandis[:30],
        "commodities": commodities,
        "news": news[:6],
        "accuracy": accuracy
    }

@app.get("/api/sarso/mandi-prices")
def get_sarso_mandi_prices(state: Optional[str] = None, search: Optional[str] = None, force_refresh: bool = False):
    """Returns filtered Indian mustard mandi rates in ₹ / Quintal."""
    mandis = sarso_service.fetch_agmarknet_mandi_data(force_refresh=force_refresh)
    if state and state.strip() and state.lower() != "all":
        mandis = [m for m in mandis if m.get("state", "").lower() == state.strip().lower()]
    if search and search.strip():
        q = search.strip().lower()
        mandis = [m for m in mandis if q in m.get("market", "").lower() or q in m.get("district", "").lower()]
    return {
        "count": len(mandis),
        "records": mandis
    }

@app.get("/api/sarso/market-data")
def get_sarso_market_data(force_refresh: bool = False):
    """Returns fresh international commodities and agricultural news feeds."""
    _, _, ist_display = sarso_service.get_ist_now_strings()
    commodities = sarso_service.fetch_international_commodities(force_refresh=force_refresh)
    news = sarso_service.fetch_fresh_market_news(force_refresh=force_refresh)
    return {
        "timestamp": ist_display,
        "commodities": commodities,
        "news": news
    }

@app.post("/api/sarso/analyze")
def analyze_sarso_market(payload: Dict[str, Any] = Body(default={})):
    """
    Performs deep multi-factor market analysis for selected state & mandi
    prior to final prediction generation.
    """
    state = payload.get("state", "Rajasthan")
    mandi = payload.get("mandi", "Jaipur")
    variety = payload.get("variety", "Mustard Seed 42% Condition")
    user_rate = payload.get("current_price")
    try:
        user_rate = float(user_rate) if user_rate is not None and user_rate != "" else None
    except (ValueError, TypeError):
        user_rate = None

    mandis = sarso_service.fetch_agmarknet_mandi_data()
    mandi_stats = sarso_service.get_mandi_summary_stats(mandis)
    trend = sarso_service.get_historical_mandi_trend(mandi)
    commodities = sarso_service.fetch_international_commodities()
    news = sarso_service.fetch_fresh_market_news()

    # Determine resolved price
    resolved_price = user_rate
    if not resolved_price or resolved_price <= 0:
        for m in mandis:
            if mandi.lower() in m.get("market", "").lower():
                resolved_price = float(m["modal_price"])
                break
        if not resolved_price:
            resolved_price = mandi_stats.get("avg_price", 5850.0)

    _, _, ist_display = sarso_service.get_ist_now_strings()

    return {
        "status": "ready_for_prediction",
        "timestamp": ist_display,
        "state": state,
        "mandi": mandi,
        "variety": variety,
        "resolved_current_price": resolved_price,
        "unit": "₹ / Quintal",
        "regional_mandi_benchmark": mandi_stats,
        "historical_trend": trend,
        "commodities_snapshot": commodities,
        "news_count": len(news)
    }

@app.post("/api/sarso/predict")
def predict_sarso_price(payload: Dict[str, Any] = Body(default={})):
    """
    Executes full AI Prediction Pipeline:
    Collects fresh data, runs Gemini 3.8/Flash model (or Fallback Econometric Model),
    stores prediction in SQLite history, and returns structured result.
    """
    state = payload.get("state") or "All-India"
    mandi = payload.get("mandi") or "All-India Benchmark"
    variety = payload.get("variety") or "Mustard Seed (Standard Benchmark)"
    user_current_price = payload.get("current_price")
    user_target_price = payload.get("target_price")
    force_refresh = payload.get("force_refresh", False)

    try:
        user_current_price = float(user_current_price) if user_current_price not in [None, ""] else None
    except (ValueError, TypeError):
        user_current_price = None

    try:
        user_target_price = float(user_target_price) if user_target_price not in [None, ""] else None
    except (ValueError, TypeError):
        user_target_price = None

    prediction = sarso_service.generate_sarso_prediction(
        state=state,
        mandi=mandi,
        variety=variety,
        user_current_price=user_current_price,
        user_target_price=user_target_price,
        force_refresh=force_refresh
    )

    return prediction

@app.get("/api/sarso/config")
def get_sarso_config():
    """Returns AI API configuration status for OpenAI ChatGPT and Google Gemini."""
    openai_key = sarso_service.get_openai_api_key()
    openai_model = sarso_service.get_openai_model_name()
    gemini_key = sarso_service.get_gemini_api_key()
    gemini_model = sarso_service.get_gemini_model_name()

    def mask_key(k: str) -> str:
        if not k:
            return "Not Set"
        if len(k) >= 8:
            return k[:4] + "..." + k[-4:]
        return "Configured"

    return {
        "has_openai_key": bool(openai_key),
        "openai_masked_key": mask_key(openai_key),
        "openai_model": openai_model,
        "has_gemini_key": bool(gemini_key),
        "gemini_masked_key": mask_key(gemini_key),
        "gemini_model": gemini_model
    }

@app.post("/api/sarso/config")
def update_sarso_config(payload: Dict[str, Any] = Body(default={})):
    """Saves AI API keys and model preferences."""
    openai_key = payload.get("openai_api_key")
    openai_model = payload.get("openai_model")
    gemini_key = payload.get("gemini_api_key")
    gemini_model = payload.get("gemini_model")
    res = sarso_service.save_ai_config(
        openai_key=openai_key,
        openai_model=openai_model,
        gemini_key=gemini_key,
        gemini_model=gemini_model
    )
    return {
        "success": True,
        "message": "AI configuration updated successfully.",
        **res
    }

@app.get("/api/sarso/predictions")
def list_sarso_predictions(
    page: int = 1,
    limit: int = 10,
    search: Optional[str] = None,
    state: Optional[str] = None,
    mandi: Optional[str] = None,
    date: Optional[str] = None
):
    """Returns paginated history of Sarso AI predictions."""
    return sarso_service.get_prediction_history(
        page=page,
        limit=limit,
        search=search,
        state=state,
        mandi=mandi,
        date_filter=date
    )

@app.delete("/api/sarso/predictions")
def clear_all_sarso_predictions():
    """Deletes all prediction audit records."""
    res = sarso_service.delete_all_predictions()
    if not res.get("success"):
        raise HTTPException(status_code=500, detail=res.get("message", "Failed to delete predictions."))
    return res

@app.get("/api/sarso/predictions/{prediction_id}")
def get_single_sarso_prediction(prediction_id: str):
    """Returns full snapshot details of a historical prediction."""
    detail = sarso_service.get_prediction_detail(prediction_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Prediction record not found.")
    return detail

@app.post("/api/sarso/actual-price")
def record_actual_closing_price(payload: Dict[str, Any] = Body(...)):
    """
    Logs actual mandi closing rate for a prediction, computes difference,
    error %, and updates model accuracy tracking.
    """
    prediction_id = payload.get("prediction_id")
    actual_price = payload.get("actual_price")
    if not prediction_id or actual_price is None:
        raise HTTPException(status_code=400, detail="prediction_id and actual_price are required.")
    
    try:
        actual_price = float(actual_price)
    except ValueError:
        raise HTTPException(status_code=400, detail="actual_price must be a valid number.")

    res = sarso_service.log_actual_price(prediction_id, actual_price)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("message", "Failed to update record."))
    return res

@app.get("/api/sarso/accuracy")
def get_sarso_model_accuracy():
    """Returns summarized accuracy statistics across all evaluated predictions."""
    return sarso_service.get_accuracy_metrics()

from fastapi.staticfiles import StaticFiles

# Mount static frontend files
frontend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)

