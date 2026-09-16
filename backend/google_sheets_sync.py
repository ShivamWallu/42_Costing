"""
Google Sheets Daily Synchronization Engine for Khandelia 42 Costing Platform.
Connects to Google Sheet, detects new & updated records, validates, runs 42 costing engine,
updates SQLite index, and refreshes ML anomalies and AI insights.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import io
import csv
import json
import sqlite3
import datetime
import requests
from typing import Dict, Any, List, Optional
from database import get_db_connection
from validator import validate_and_normalize_row
from costing_engine import evaluate_full_transaction_costing
from ml_analytics import run_anomaly_detection

# Default or configured Sheet parameters
DEFAULT_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "")
DEFAULT_SHEET_GID = os.environ.get("GOOGLE_SHEET_GID", "0")

def sync_from_csv_stream(csv_content: str, source_name: str = "Google Sheet Live Sync") -> Dict[str, Any]:
    """
    Parses CSV content from Google Sheets, reconciles with SQLite,
    calculates 42 costing for all affected rows, and triggers ML refresh.
    """
    reader = csv.reader(io.StringIO(csv_content))
    rows = list(reader)
    if not rows or len(rows) < 2:
        return {"status": "ERROR", "message": "No rows found in sheet content."}

    # Find header row
    header_idx = 0
    headers = [h.strip() for h in rows[header_idx]]
    
    # Map header column names to standard keys
    # Handle both column letters and names
    col_mapping = {
        'supervisor_name': ['Supervisor Name', 'Supervisor', 'Col H'],
        'gin': ['GIN', 'Col I'],
        'gin_date': ['GIN Date', 'Col J'],
        'grn_no': ['GRN No.', 'GRN No', 'GRN', 'Col K'],
        'po_no': ['Po NO', 'PO No', 'PO NO', 'Col C'],
        'grn_date': ['GRN Date', 'Col M'],
        'lab_report_date': ['Lab Report Date', 'Lab Date', 'Col P'],
        'supplier_code': ['Supplier Code', 'Col Q'],
        'supplier_name': ['Supplier Name', 'Supplier', 'Col R'],
        'station': ['Station', 'Mandi', 'Col S'],
        'broker_name': ['Broker Name', 'Broker', 'Col U'],
        'bill_wt': ['Bill Wt.', 'Bill Wt', 'Col AI'],
        'rec_wt': ['Rec Wt.', 'Rec Wt', 'Col AJ'],
        'gross_wt': ['Gross Wt.', 'Gross Wt', 'Col AL'],
        'bill_amount': ['Bill Amount', 'Col AN'],
        'actual_rate': ['A.Rate', 'Actual Rate', 'Rate', 'Col AT'],
        'party_condition': ['Party Condition', 'Party Cond', 'Col AV'],
        'oil_manual': ['Oil Manual', 'Col AW'],
        'oil_analyzer': ['Oil Analizer', 'Oil Analyzer', 'Col AX'],
        'fm': ['F.M', 'FM', 'Col BA'],
        'greenish': ['Greenish', 'Col BB'],
        'moisture_pre': ['Moisture Pre-semple', 'Moisture Pre', 'Col BC'],
        'moisture_qc': ['Moisture In QC', 'Moisture QC', 'Col BD'],
        'ffa': ['FFA', 'Col BG']
    }

    key_to_col_idx = {}
    for standard_key, aliases in col_mapping.items():
        for i, h in enumerate(headers):
            if any(alias.lower() == h.lower() for alias in aliases):
                key_to_col_idx[standard_key] = i
                break

    conn = get_db_connection()
    cursor = conn.cursor()
    
    new_count = 0
    updated_count = 0
    error_count = 0
    
    for r_idx in range(header_idx + 1, len(rows)):
        row = rows[r_idx]
        if not any(c.strip() for c in row):
            continue
            
        def get_val(key):
            idx = key_to_col_idx.get(key)
            if idx is not None and idx < len(row):
                return row[idx].strip()
            return None

        raw = {k: get_val(k) for k in col_mapping.keys()}
        
        try:
            v = validate_and_normalize_row(raw)
            c = evaluate_full_transaction_costing(
                bill_amount=v['bill_amount'],
                bill_weight=v['bill_wt'],
                party_condition=v['party_condition'],
                oil_manual=v['oil_manual'],
                oil_analyzer=v['oil_analyzer'],
                gross_weight=v['gross_wt'],
                override_actual_rate=v['actual_rate']
            )
            
            grn_val = v['grn_no'] or f"GEN-{v['gin']}-{v['po_no']}-{r_idx}"
            
            # Check existing
            cursor.execute("SELECT id FROM transactions WHERE grn_no = ?", (grn_val,))
            existing = cursor.fetchone()
            
            if existing:
                cursor.execute("""
                    UPDATE transactions SET
                        gin = ?, po_no = ?, supervisor_name = ?, supplier_code = ?, supplier_name = ?,
                        station = ?, station_original = ?, broker_name = ?, broker_original = ?,
                        gin_date = ?, grn_date = ?, lab_report_date = ?, bill_wt = ?, rec_wt = ?, gross_wt = ?,
                        bill_amount = ?, actual_rate = ?, party_condition = ?, condition_rate_42 = ?,
                        oil_manual = ?, oil_analyzer = ?, cost_42 = ?, costing_status = ?, costing_message = ?,
                        cost_diff = ?, cost_diff_pct = ?, impact_type = ?, oil_diff_condition = ?,
                        oil_diff_analyzer = ?, analyzer_cost_42 = ?, theoretical_oil_weight_qtl = ?,
                        fm_pct = ?, greenish_pct = ?, moisture_pre_pct = ?, moisture_qc = ?, ffa = ?,
                        audit_flags = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (
                    v['gin'], v['po_no'], v['supervisor_name'], v['supplier_code'], v['supplier_name'],
                    v['station'], v['station_original'], v['broker_name'], v['broker_original'],
                    v['gin_date'], v['grn_date'], v['lab_report_date'], v['bill_wt'], v['rec_wt'], v['gross_wt'],
                    v['bill_amount'], c['actual_rate'], c['party_condition'], c['condition_rate_42'],
                    c['oil_manual'], c['oil_analyzer'], c['cost_42'], c['costing_status'], c['costing_message'],
                    c['cost_diff'], c['cost_diff_pct'], c['impact_type'], c['oil_diff_condition'],
                    c['oil_diff_analyzer'], c['analyzer_cost_42'], c['theoretical_oil_weight_qtl'],
                    v['fm_pct'], v['greenish_pct'], v['moisture_pre_pct'], v['moisture_qc'], v['ffa'],
                    json.dumps(v['audit_flags']), existing['id']
                ))
                updated_count += 1
            else:
                cursor.execute("""
                    INSERT INTO transactions (
                        gin, grn_no, po_no, supervisor_name, supplier_code, supplier_name,
                        station, station_original, broker_name, broker_original,
                        gin_date, grn_date, lab_report_date, bill_wt, rec_wt, gross_wt,
                        bill_amount, actual_rate, party_condition, condition_rate_42,
                        oil_manual, oil_analyzer, cost_42, costing_status, costing_message,
                        cost_diff, cost_diff_pct, impact_type, oil_diff_condition,
                        oil_diff_analyzer, analyzer_cost_42, theoretical_oil_weight_qtl,
                        fm_pct, greenish_pct, moisture_pre_pct, moisture_qc, ffa,
                        audit_flags
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?
                    )
                """, (
                    v['gin'], grn_val, v['po_no'], v['supervisor_name'], v['supplier_code'], v['supplier_name'],
                    v['station'], v['station_original'], v['broker_name'], v['broker_original'],
                    v['gin_date'], v['grn_date'], v['lab_report_date'], v['bill_wt'], v['rec_wt'], v['gross_wt'],
                    v['bill_amount'], c['actual_rate'], c['party_condition'], c['condition_rate_42'],
                    c['oil_manual'], c['oil_analyzer'], c['cost_42'], c['costing_status'], c['costing_message'],
                    c['cost_diff'], c['cost_diff_pct'], c['impact_type'], c['oil_diff_condition'],
                    c['oil_diff_analyzer'], c['analyzer_cost_42'], c['theoretical_oil_weight_qtl'],
                    v['fm_pct'], v['greenish_pct'], v['moisture_pre_pct'], v['moisture_qc'], v['ffa'],
                    json.dumps(v['audit_flags'])
                ))
                new_count += 1
        except Exception as ex:
            error_count += 1
            print(f"Sync error on row {r_idx}: {ex}")

    conn.commit()
    
    # Log sync event
    cursor.execute("""
        INSERT INTO sync_logs (sync_source, total_rows, new_rows, updated_rows, error_rows, status, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        source_name,
        new_count + updated_count + error_count,
        new_count,
        updated_count,
        error_count,
        "SUCCESS" if error_count == 0 else "PARTIAL",
        f"Synced: {new_count} new, {updated_count} updated, {error_count} errors."
    ))
    conn.commit()
    conn.close()

    # Re-run ML Anomaly Detection on refreshed dataset
    ml_res = run_anomaly_detection()

    return {
        "status": "SUCCESS",
        "new_records": new_count,
        "updated_records": updated_count,
        "errors": error_count,
        "ml_flagged": ml_res.get("flagged", 0),
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def sync_from_google_sheet(sheet_id: str = None, gid: str = "0") -> Dict[str, Any]:
    """
    Downloads published Google Sheets CSV stream and runs reconciliation.
    """
    target_sheet_id = sheet_id or DEFAULT_SHEET_ID
    if not target_sheet_id:
        return {
            "status": "CONFIG_REQUIRED",
            "message": "Google Sheet ID is not configured. Please set GOOGLE_SHEET_ID in settings or environment."
        }
    
    url = f"https://docs.google.com/spreadsheets/d/{target_sheet_id}/export?format=csv&gid={gid}"
    try:
        resp = requests.get(url, timeout=30)
        if resp.status_code != 200:
            return {
                "status": "FETCH_FAILED",
                "message": f"Failed to fetch Google Sheet: HTTP {resp.status_code}. Ensure the sheet has sharing enabled ('Anyone with the link can view')."
            }
        
        return sync_from_csv_stream(resp.text, source_name=f"Google Sheet ({target_sheet_id})")
    except Exception as e:
        return {
            "status": "NETWORK_ERROR",
            "message": f"Failed connecting to Google Sheet: {str(e)}"
        }
