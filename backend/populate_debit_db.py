"""
Populate debit_note_records and transactions tables in SQLite from:
1. Primary Master: Uploaded_Debit Note Sheet (7 ) Dated 25.05.2026 xls (1).xlsx (All 2,038 records)
2. Lab Enrichment: Lab Report Unit-1 (2026-27).xlsx (Supervisor Name, Broker Name, Brokerage Rate, Oil Analyzer AX)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import openpyxl
import pandas as pd
import numpy as np
import datetime
import sqlite3
import json
from typing import Optional, Dict, Any
from database import get_db_connection, init_db, is_postgres
from validator import normalize_station

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DEBIT_DIR = os.path.join(BASE_DIR, "Debit_Note_Sheet")
DEFAULT_LAB_DIR = os.path.join(BASE_DIR, "42_Costing_data_daily_update")

def safe_float(val, default=0.0):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if s == '' or s.startswith('#') or s.lower() == 'none':
        return default
    try:
        return float(s.replace(',', ''))
    except:
        return default

def format_date_str(val):
    if not val:
        return ''
    if isinstance(val, (datetime.date, datetime.datetime)):
        return val.strftime('%Y-%m-%d')
    s = str(val).strip()
    if '/' in s:
        parts = s.split('/')
        if len(parts) == 3:
            d, m, y = parts[0], parts[1], parts[2]
            if len(y) == 4:
                return f"{y}-{int(m):02d}-{int(d):02d}"
    if '-' in s and len(s) >= 10:
        return s[:10]
    return s

def find_master_debit_file(directory: str) -> Optional[str]:
    if not os.path.exists(directory):
        return None
    valid_files = [
        os.path.join(directory, f) for f in os.listdir(directory)
        if f.endswith(('.xlsx', '.xls', '.csv')) and not f.startswith('~$')
    ]
    if not valid_files:
        return None
    # Sort files by modification time, newest first
    valid_files.sort(key=os.path.getmtime, reverse=True)

    # Prefer newest Uploaded file
    uploaded_files = [f for f in valid_files if "Uploaded_" in os.path.basename(f)]
    if uploaded_files:
        return uploaded_files[0]

    return valid_files[0]

def find_lab_file(directory: str) -> Optional[str]:
    if not os.path.exists(directory):
        return None
    files = [
        os.path.join(directory, f) for f in os.listdir(directory)
        if f.endswith(('.xlsx', '.xls')) and not f.startswith('~$')
    ]
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    lab_files = [f for f in files if "Lab Report" in os.path.basename(f)]
    if lab_files:
        return lab_files[0]
    return files[0]

def populate(custom_debit_path: Optional[str] = None, custom_lab_path: Optional[str] = None) -> Dict[str, Any]:
    # Ensure database schema is initialized
    init_db()

    debit_path = custom_debit_path or find_master_debit_file(DEFAULT_DEBIT_DIR)
    lab_path = custom_lab_path or find_lab_file(DEFAULT_LAB_DIR)

    if not debit_path or not os.path.exists(debit_path):
        return {"success": False, "error": f"Debit note file not found at {debit_path}"}

    print(f"Loading Primary Master: {debit_path}")
    print(f"Loading Lab Enrichment: {lab_path}")

    # 1. Build Lab Enrichment Mapping (strictly extracting Supervisor, Broker Name, Brokerage Rate, Oil AX + lab quality)
    lab_gin_map = {}
    lab_po_map = {}
    if lab_path and os.path.exists(lab_path):
        try:
            wb_lab = openpyxl.load_workbook(lab_path, read_only=True, data_only=True)
            ws_lab = wb_lab['Apr-26 To Mar-27'] if 'Apr-26 To Mar-27' in wb_lab.sheetnames else wb_lab.active
            for r in ws_lab.iter_rows(values_only=True):
                gin = str(r[8]).strip() if len(r) > 8 and r[8] is not None else ''
                po = str(r[2]).strip() if len(r) > 2 and r[2] is not None else ''
                grn_no = str(r[10]).strip() if len(r) > 10 and r[10] is not None else ''
                grn_date = format_date_str(r[12] if len(r) > 12 else None)
                lab_date = format_date_str(r[15] if len(r) > 15 else None)
                
                info = {
                    'supervisor': str(r[7]).strip() if len(r) > 7 and r[7] is not None else '',
                    'broker_name': str(r[20]).strip() if len(r) > 20 and r[20] is not None else '',
                    'brokerage_rate': safe_float(r[21] if len(r) > 21 else None),
                    'oil_analyzer_ax': safe_float(r[49] if len(r) > 49 else None),
                    'oil_manual': safe_float(r[48] if len(r) > 48 else None),
                    'grn_no': grn_no,
                    'grn_date': grn_date,
                    'lab_date': lab_date,
                    'fm': safe_float(r[52] if len(r) > 52 else None),
                    'greenish': safe_float(r[53] if len(r) > 53 else None),
                    'moisture_pre': safe_float(r[54] if len(r) > 54 else None),
                    'moisture_qc': safe_float(r[55] if len(r) > 55 else None),
                    'ffa': safe_float(r[58] if len(r) > 58 else None),
                }
                if gin:
                    lab_gin_map[gin] = info
                if po:
                    lab_po_map[po] = info
            wb_lab.close()
            print(f"Loaded {len(lab_gin_map)} Lab GIN mappings, {len(lab_po_map)} PO mappings.")
        except Exception as e:
            print(f"Warning: Could not parse lab file: {e}")

    # 2. Read Primary Debit Note Master
    wb_deb = openpyxl.load_workbook(debit_path, read_only=True, data_only=True)
    ws_deb = wb_deb.active
    rows_iter = ws_deb.iter_rows(values_only=True)
    header = next(rows_iter)
    
    debit_insert_rows = []
    trans_insert_rows = []
    
    row_count = 0
    matched_supervisor_count = 0
    oil_comparison_count = 0
    oil_variance_count = 0

    raw_parsed_rows = []
    gin_totals = {}

    for r in rows_iter:
        po_no = str(r[0]).strip() if len(r) > 0 and r[0] is not None else ''
        gin = str(r[3]).strip() if len(r) > 3 and r[3] is not None else ''
        date_raw = r[4] if len(r) > 4 else None
        date_str = format_date_str(date_raw)
        supplier_code = str(r[5]).strip() if len(r) > 5 and r[5] is not None else ''
        supplier_name = str(r[6]).strip() if len(r) > 6 and r[6] is not None else ''
        raw_station = str(r[7]).strip() if len(r) > 7 and r[7] is not None else ''
        _, station, _ = normalize_station(raw_station)
        bill_no = str(r[13]).strip() if len(r) > 13 and r[13] is not None else ''
        bill_wt_qtl = safe_float(r[22] if len(r) > 22 else None)
        rec_wt_qtl = safe_float(r[23] if len(r) > 23 else None)
        bill_amt_y = safe_float(r[24] if len(r) > 24 else None)

        if not gin and not supplier_name and bill_amt_y == 0:
            continue

        # Handle decimal typo in raw sheet if bill_wt was typed with extra digit
        if bill_wt_qtl > 0 and bill_amt_y > 0:
            implied_rate = bill_amt_y / bill_wt_qtl
            if implied_rate < 1500 and (bill_amt_y / (bill_wt_qtl / 10.0)) > 6000:
                bill_wt_qtl = round(bill_wt_qtl / 10.0, 2)

        # Track total bill weight per GIN
        if gin not in gin_totals:
            gin_totals[gin] = {'total_bill_wt': 0.0, 'truck_rec_wt': rec_wt_qtl, 'count': 0}
        gin_totals[gin]['total_bill_wt'] += bill_wt_qtl
        gin_totals[gin]['count'] += 1
        if rec_wt_qtl > gin_totals[gin]['truck_rec_wt']:
            gin_totals[gin]['truck_rec_wt'] = rec_wt_qtl

        raw_parsed_rows.append({
            'po_no': po_no,
            'gin': gin,
            'date_str': date_str,
            'supplier_code': supplier_code,
            'supplier_name': supplier_name,
            'station': station,
            'bill_no': bill_no,
            'bill_wt_qtl': bill_wt_qtl,
            'rec_wt_qtl': rec_wt_qtl,
            'bill_amt_y': bill_amt_y,
            'raw_row': r
        })

    for row_dict in raw_parsed_rows:
        r = row_dict['raw_row']
        po_no = row_dict['po_no']
        gin = row_dict['gin']
        date_str = row_dict['date_str']
        supplier_code = row_dict['supplier_code']
        supplier_name = row_dict['supplier_name']
        station = row_dict['station']
        bill_no = row_dict['bill_no']
        bill_wt_qtl = row_dict['bill_wt_qtl']
        bill_amt_y = row_dict['bill_amt_y']

        row_count += 1
        s_no = row_count

        # Quality Deductions
        oil_ded = safe_float(r[36] if len(r) > 36 else None)
        bardana_ded = safe_float(r[37] if len(r) > 37 else None)
        fm_ded = safe_float(r[38] if len(r) > 38 else None)
        brokerage_ded = safe_float(r[39] if len(r) > 39 else None)
        shortage_ded = safe_float(r[40] if len(r) > 40 else None)
        greenish_ded = safe_float(r[41] if len(r) > 41 else None)
        moisture_ded = safe_float(r[42] if len(r) > 42 else None)
        net_ded = safe_float(r[43] if len(r) > 43 else None)

        # Additional quality parameters from Debit Note
        fm_pct_dn = safe_float(r[33] if len(r) > 33 else None)
        greenish_pct_dn = safe_float(r[34] if len(r) > 34 else None)
        moisture_pct_dn = safe_float(r[35] if len(r) > 35 else None)

        # Primary Oil from Debit Note Col BY (Col 76/77) or Fallback Col AG (Col 32/33)
        oil_by = safe_float(r[76] if len(r) > 76 else None)
        if oil_by == 0:
            oil_by = safe_float(r[32] if len(r) > 32 else None)

        # Enrich strictly from Lab Report
        lab_info = lab_gin_map.get(gin) or lab_po_map.get(po_no) or {}
        supervisor = lab_info.get('supervisor', '')
        broker_name = lab_info.get('broker_name', '')
        brokerage_rate = lab_info.get('brokerage_rate', 0.0)
        oil_ax = lab_info.get('oil_analyzer_ax', 0.0)
        oil_manual = lab_info.get('oil_manual', 0.0)
        grn_no = lab_info.get('grn_no', '')
        if not grn_no:
            grn_no = f"GRN-{gin}" if gin else f"REC-{s_no:04d}"
        grn_date = lab_info.get('grn_date', '') or date_str
        lab_report_date = lab_info.get('lab_date', '') or date_str
        ffa_val = lab_info.get('ffa', 0.0)

        if supervisor:
            matched_supervisor_count += 1

        # Dual Oil Comparison & Discrepancy Flagging
        primary_oil = oil_by if oil_by > 0 else (oil_ax if oil_ax > 0 else None)
        oil_diff = round(abs(oil_by - oil_ax), 4) if (oil_by > 0 and oil_ax > 0) else 0.0
        oil_mismatch = 1 if oil_diff > 0.05 else 0

        if oil_by > 0 and oil_ax > 0:
            oil_comparison_count += 1
            if oil_mismatch:
                oil_variance_count += 1

        # Pro-Rata Multi-PO Weight Allocation
        gin_meta = gin_totals.get(gin, {'total_bill_wt': bill_wt_qtl, 'truck_rec_wt': row_dict['rec_wt_qtl'], 'count': 1})
        is_multi_po = gin_meta['count'] > 1 and gin_meta['total_bill_wt'] > 0
        truck_rec_wt = gin_meta['truck_rec_wt']

        if is_multi_po:
            pro_rata_ratio = bill_wt_qtl / gin_meta['total_bill_wt']
            alloc_rec_wt_qtl = round(pro_rata_ratio * truck_rec_wt, 2)
            alloc_rec_wt_mt = round(alloc_rec_wt_qtl / 10.0, 4)
        else:
            alloc_rec_wt_qtl = row_dict['rec_wt_qtl']
            alloc_rec_wt_mt = round(alloc_rec_wt_qtl / 10.0, 4) if alloc_rec_wt_qtl > 0 else 0.0

        # Rate calculations
        if bill_wt_qtl > 0:
            billed_rate_qtl = round(bill_amt_y / bill_wt_qtl, 2)
        elif alloc_rec_wt_qtl > 0:
            billed_rate_qtl = round(bill_amt_y / alloc_rec_wt_qtl, 2)
        else:
            billed_rate_qtl = 0.0
        billed_rate_mt = round(billed_rate_qtl * 10.0, 2)

        if alloc_rec_wt_mt > 0:
            landing_cost_mt = round((bill_amt_y - net_ded) / alloc_rec_wt_mt, 2)
            landing_cost_qtl = round(landing_cost_mt / 10.0, 2)
        else:
            landing_cost_mt = None
            landing_cost_qtl = None

        if primary_oil and primary_oil > 0 and landing_cost_mt:
            cost_42_mt = round((landing_cost_mt / primary_oil) * 42.0, 2)
            cost_42_qtl = round((landing_cost_qtl / primary_oil) * 42.0, 2)
            diff_mt = round(cost_42_mt - landing_cost_mt, 2)
            diff_qtl = round(cost_42_qtl - landing_cost_qtl, 2)
        else:
            cost_42_mt = None
            cost_42_qtl = None
            diff_mt = None
            diff_qtl = None

        final_effective_cost_mt = cost_42_mt

        if cost_42_qtl and billed_rate_qtl > 0:
            rate_diff_qtl = round(cost_42_qtl - billed_rate_qtl, 2)
            rate_diff_mt = round(rate_diff_qtl * 10.0, 2)
        else:
            rate_diff_qtl = None
            rate_diff_mt = None

        # Status & Audit Remarks
        status = "Matched"
        remarks_list = []
        if is_multi_po:
            remarks_list.append(f"Multi-PO Truck Split (Truck Rec: {truck_rec_wt:.1f} Qtl, Alloc: {alloc_rec_wt_qtl:.1f} Qtl)")

        if not lab_info:
            status = "Lab Report Not Matched"
            remarks_list.append("Lot pending in Lab Report Unit-1")
        elif not primary_oil:
            status = "Lab Data Not Available"
            remarks_list.append("NIR Oil measurement unavailable")
        elif oil_mismatch:
            status = "Oil Discrepancy Flagged"
            remarks_list.append(f"Oil Mismatch: BY ({oil_by:.2f}%) vs AX ({oil_ax:.2f}%) Diff={oil_diff:.2f}%")

        if net_ded > 0:
            ded_items = []
            if oil_ded > 0: ded_items.append(f"Oil: ₹{oil_ded:,.0f}")
            if shortage_ded > 0: ded_items.append(f"Shortage: ₹{shortage_ded:,.0f}")
            if bardana_ded > 0: ded_items.append(f"Bardana: ₹{bardana_ded:,.0f}")
            if moisture_ded > 0: ded_items.append(f"Moisture: ₹{moisture_ded:,.0f}")
            if brokerage_ded > 0: ded_items.append(f"Brokerage: ₹{brokerage_ded:,.0f}")
            if ded_items:
                remarks_list.append(f"Deductions: {', '.join(ded_items)}")

        remarks_str = " | ".join(remarks_list) if remarks_list else "Fully reconciled & verified"

        # Debit Note Table Row
        debit_insert_rows.append((
            s_no, gin, po_no, supplier_code, supplier_name, station, supervisor,
            broker_name, brokerage_rate, date_str, bill_no,
            bill_wt_qtl, alloc_rec_wt_mt, alloc_rec_wt_qtl, bill_amt_y, bill_amt_y,
            billed_rate_qtl, billed_rate_mt, rate_diff_qtl, rate_diff_mt,
            net_ded, landing_cost_mt, landing_cost_qtl, primary_oil,
            oil_by, oil_ax, oil_diff, oil_mismatch,
            fm_pct_dn, greenish_pct_dn, moisture_pct_dn,
            cost_42_mt, cost_42_qtl, diff_qtl, diff_mt, final_effective_cost_mt,
            status, remarks_str,
            oil_ded, bardana_ded, fm_ded,
            brokerage_ded, shortage_ded, greenish_ded,
            moisture_ded
        ))

        # Transactions Table Row for Analytics & Dashboard
        actual_rate = billed_rate_qtl
        cost_42_trans = cost_42_qtl if cost_42_qtl else actual_rate
        cost_diff = round(cost_42_trans - actual_rate, 2) if actual_rate > 0 else 0.0
        cost_diff_pct = round((cost_diff / actual_rate) * 100.0, 2) if actual_rate > 0 else 0.0
        impact_type = "LOSS" if cost_diff > 0 else "PROFIT"
        oil_diff_condition = round(primary_oil - 42.0, 2) if primary_oil else 0.0
        oil_diff_analyzer = round(oil_manual - primary_oil, 2) if (oil_manual and primary_oil) else 0.0
        theo_oil_wt = round((rec_wt_qtl * primary_oil) / 100.0, 2) if (rec_wt_qtl and primary_oil) else 0.0
        
        costing_status = "COMPLETED" if primary_oil else "LAB_PENDING"
        costing_msg = remarks_str
        
        # Anomaly scoring
        is_anomaly = 1 if (oil_mismatch or oil_diff_condition < -2.0 or cost_diff_pct > 5.0) else 0
        anomaly_score = abs(cost_diff_pct) if is_anomaly else 0.0
        anomaly_reasons = json.dumps(remarks_list) if is_anomaly else "[]"
        audit_flags = json.dumps([f"Oil Diff BY-AX: {oil_diff:.2f}%"]) if oil_mismatch else json.dumps([])

        trans_insert_rows.append((
            gin, grn_no, po_no, supervisor, supplier_code, supplier_name,
            station, station, broker_name, broker_name,
            date_str, grn_date, lab_report_date,
            bill_wt_qtl, rec_wt_qtl, rec_wt_qtl, bill_amt_y,
            actual_rate, 42.0, cost_42_trans,
            oil_manual, primary_oil, cost_42_trans,
            costing_status, costing_msg, cost_diff, cost_diff_pct,
            impact_type, oil_diff_condition, oil_diff_analyzer,
            cost_42_trans, theo_oil_wt,
            fm_pct_dn, greenish_pct_dn, moisture_pct_dn,
            lab_info.get('moisture_qc', 0.0), ffa_val,
            is_anomaly, anomaly_score, anomaly_reasons, audit_flags
        ))

    wb_deb.close()

    # Open DB connection
    conn = get_db_connection()
    cursor = conn.cursor()
    use_pg = is_postgres()

    # Step 1: Check and rotate backup (Latest -> Previous Backup, older backups auto-deleted)
    try:
        cursor.execute("SELECT COUNT(*) FROM debit_note_records;")
        active_count = cursor.fetchone()[0]
    except Exception:
        active_count = 0

    if active_count > 0:
        print(f"Creating rolling backup of current {active_count} active records...")
        # Auto-delete any older backup tables so we only keep exactly 1 backup generation
        cursor.execute("DROP TABLE IF EXISTS debit_note_records_backup;")
        cursor.execute("DROP TABLE IF EXISTS transactions_backup;")
        # Snapshot current active data into backup tables
        cursor.execute("CREATE TABLE debit_note_records_backup AS SELECT * FROM debit_note_records;")
        cursor.execute("CREATE TABLE transactions_backup AS SELECT * FROM transactions;")
        print("Previous upload successfully preserved as backup.")

    # Step 2: Ensure schema & indexes exist
    init_db()

    # Step 3: Fast truncate of active tables (resets identities and clears active rows in milliseconds)
    if use_pg:
        cursor.execute("TRUNCATE TABLE debit_note_records RESTART IDENTITY CASCADE;")
        cursor.execute("TRUNCATE TABLE transactions RESTART IDENTITY CASCADE;")
    else:
        cursor.execute("DELETE FROM debit_note_records;")
        cursor.execute("DELETE FROM transactions;")

    # Step 4: Bulk insert new records
    cursor.executemany("""
    INSERT INTO debit_note_records (
        s_no, gin, po_no, supplier_code, supplier_name, station, supervisor_name,
        broker_name, brokerage_rate, date, bill_no,
        bill_wt_qtl, rec_wt_mt, rec_wt_qtl, taxable_amt_an, debit_amt_y,
        billed_rate_qtl, billed_rate_mt, rate_diff_qtl, rate_diff_mt,
        net_ded, landing_cost_mt, landing_cost_qtl, oil_nir,
        oil_analyzer_by, oil_analyzer_ax, oil_nir_diff, oil_mismatch_flag,
        fm_pct, greenish_pct, moisture_pct,
        cost_42_mt, cost_42_qtl, diff_qtl, diff_mt, final_effective_cost_mt,
        status, remarks,
        oil_ded, bardana_ded, fm_ded,
        brokerage_ded, shortage_ded, greenish_ded,
        moisture_ded
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, debit_insert_rows)

    cursor.executemany("""
    INSERT INTO transactions (
        gin, grn_no, po_no, supervisor_name, supplier_code, supplier_name,
        station, station_original, broker_name, broker_original,
        gin_date, grn_date, lab_report_date,
        bill_wt, rec_wt, gross_wt, bill_amount,
        actual_rate, party_condition, condition_rate_42,
        oil_manual, oil_analyzer, cost_42,
        costing_status, costing_message, cost_diff, cost_diff_pct,
        impact_type, oil_diff_condition, oil_diff_analyzer,
        analyzer_cost_42, theoretical_oil_weight_qtl,
        fm_pct, greenish_pct, moisture_pre_pct,
        moisture_qc, ffa,
        is_anomaly, anomaly_score, anomaly_reasons, audit_flags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, trans_insert_rows)

    conn.commit()
    conn.close()

    result = {
        "success": True,
        "total_records": len(debit_insert_rows),
        "supervisor_matched": matched_supervisor_count,
        "supervisor_pct": round(matched_supervisor_count / len(debit_insert_rows) * 100, 2),
        "oil_dual_compared": oil_comparison_count,
        "oil_mismatches_flagged": oil_variance_count,
        "backup_retained": active_count > 0,
        "message": f"Successfully ingested and unified {len(debit_insert_rows)} records. Previous upload kept as backup."
    }
    print(result)
    return result

def restore_previous_backup() -> Dict[str, Any]:
    """Restores debit_note_records and transactions from the previous backup."""
    conn = get_db_connection()
    cursor = conn.cursor()
    use_pg = is_postgres()

    try:
        cursor.execute("SELECT COUNT(*) FROM debit_note_records_backup;")
        backup_dn = cursor.fetchone()[0]
    except Exception:
        backup_dn = 0

    if not backup_dn or backup_dn == 0:
        conn.close()
        return {"success": False, "error": "No previous backup found in database."}

    # Ensure schema exists
    init_db()

    if use_pg:
        cursor.execute("TRUNCATE TABLE debit_note_records RESTART IDENTITY CASCADE;")
        cursor.execute("TRUNCATE TABLE transactions RESTART IDENTITY CASCADE;")
    else:
        cursor.execute("DELETE FROM debit_note_records;")
        cursor.execute("DELETE FROM transactions;")

    cursor.execute("INSERT INTO debit_note_records SELECT * FROM debit_note_records_backup;")
    cursor.execute("INSERT INTO transactions SELECT * FROM transactions_backup;")
    conn.commit()
    conn.close()

    return {
        "success": True,
        "restored_records": backup_dn,
        "message": f"Successfully restored {backup_dn} records from previous backup."
    }

def get_backup_and_storage_status(upload_dir: str = DEFAULT_DEBIT_DIR) -> Dict[str, Any]:
    """Returns the current database records count, backup count, and disk files kept."""
    conn = get_db_connection()
    cursor = conn.cursor()

    active_count = 0
    backup_count = 0
    try:
        cursor.execute("SELECT COUNT(*) FROM debit_note_records;")
        active_count = cursor.fetchone()[0]
    except Exception:
        pass

    try:
        cursor.execute("SELECT COUNT(*) FROM debit_note_records_backup;")
        backup_count = cursor.fetchone()[0]
    except Exception:
        pass

    conn.close()

    kept_files = []
    if os.path.exists(upload_dir):
        files = [
            os.path.join(upload_dir, f) for f in os.listdir(upload_dir)
            if f.endswith(('.xlsx', '.xls', '.csv')) and not f.startswith('~$')
        ]
        files.sort(key=os.path.getmtime, reverse=True)
        for f in files:
            kept_files.append({
                "filename": os.path.basename(f),
                "size_kb": round(os.path.getsize(f) / 1024, 1),
                "modified": os.path.getmtime(f)
            })

    return {
        "success": True,
        "active_records": active_count,
        "backup_records": backup_count,
        "has_backup": backup_count > 0,
        "kept_files": kept_files,
        "policy": "2-Tier Retention: Latest Upload (Active) + Previous Upload (Backup). Older versions auto-deleted."
    }

if __name__ == "__main__":
    res = populate()
    print(json.dumps(res, indent=2))
