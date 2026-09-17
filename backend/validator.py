"""
Data Quality and Validation Layer for Khandelia 42 Costing Platform.
Preserves Original Value -> Normalized Value for complete auditability.
"""

from typing import Dict, Any, List, Optional, Tuple
import datetime
import re

STATION_MAP = {
    # Sri Ganganagar / SGNR
    r'^(sgnr|sri\s*ganganagar|sriganganagar)$': "Sri Ganganagar",
    # Lalgarh Jattan (including SGNR (Lalgarh Jatan), Lalagarh, etc.)
    r'.*lal.*garh\s*jatt?an.*': "Lalgarh Jattan",
    # Rawla Mandi (including RAWLA, Rawla, SGNR (Rawla Mandi))
    r'.*rawla.*': "Rawla Mandi",
    # Jaipur
    r'^jaipur$': "Jaipur",
    # Churu
    r'^churu$': "Churu",
    # Sadulshahar (Sadulsahar / Sadulshahar)
    r'^sadul\s*sh?ahar$': "Sadulshahar",
    # Anupgarh (Anoopgarh / Anupgarh)
    r'^an[ou]+pgarh$': "Anupgarh",
    # Sri Karanpur / Karanpur
    r'.*karanpur.*': "Sri Karanpur",
    # Sri Bijaynagar / Vijaynagar
    r'.*(bijaynagar|vijaynagar).*': "Sri Bijaynagar",
    # Gharsana / New Gharsana
    r'.*gharsana.*': "Gharsana",
    # Raisinghnagar
    r'.*raisinghnagar.*': "Raisinghnagar",
    # Padampur
    r'.*padampur.*': "Padampur",
    # Kajuwala
    r'.*kajuwala.*': "Kajuwala",
    # Bikaner
    r'.*bikaner.*': "Bikaner",
    # Gajsinghpur
    r'.*gajsinghpur.*': "Gajsinghpur",
    # Hanumangarh
    r'.*hanumangarh.*': "Hanumangarh",
    # Rawatsar
    r'.*rawatsar.*': "Rawatsar",
    # Kesrisinghpur
    r'.*kesrisinghpur.*': "Kesrisinghpur",
    # Lunkaransar
    r'.*lunkaransar.*': "Lunkaransar",
    # Nohar
    r'.*nohar.*': "Nohar",
    # Goluwala
    r'.*goluwala.*': "Goluwala",
    # Sangaria
    r'.*sangaria.*': "Sangaria",
    # Sadulpur
    r'.*sadulpur.*': "Sadulpur",
    # Suratgarh
    r'.*suratgarh.*': "Suratgarh",
    # Pilibanga
    r'.*pilibanga.*': "Pilibanga",
    # Alwar
    r'.*alwar.*': "Alwar",
    # Bharatpur
    r'.*bharatpur.*': "Bharatpur"
}

BROKER_MAP = {
    "manoj kumar aggarwal": "Manoj Kumar Aggarwal",
    "manoj aggarwal": "Manoj Kumar Aggarwal",
    "brij mohan": "Brij Mohan",
    "pawan aggarwal": "Pawan Aggarwal",
    "aditya aggarwal": "Aditya Aggarwal",
    "sai commodity": "Sai Commodity",
    "jaipur commodities broking house": "Jaipur Commodities Broking House",
    "bansal broker": "Bansal Broker",
    "om prakash": "Om Prakash",
    "suresh kumar": "Suresh Kumar"
}

def clean_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if s.lower() in ['', 'none', 'nan', 'null', '#value!', '#div/0!', '#n/a']:
        return None
    return s

def clean_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip().replace(',', '')
    if s.lower() in ['', 'none', 'nan', 'null', '#value!', '#div/0!', '#n/a']:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None

def normalize_station(station_raw: Any) -> Tuple[Optional[str], Optional[str], bool]:
    """Returns (original, normalized, was_modified)"""
    raw = clean_str(station_raw)
    if not raw:
        return (None, "Direct / Local", True)
    raw_lower = raw.lower().strip()
    for pattern, canonical in STATION_MAP.items():
        if re.match(pattern, raw_lower):
            return (raw, canonical, raw != canonical)
    # Title casing default fallback
    clean = " ".join([w.capitalize() for w in raw.split()])
    return (raw, clean, raw != clean)

def normalize_broker(broker_raw: Any) -> Tuple[Optional[str], Optional[str], bool]:
    """Returns (original, normalized, was_modified)"""
    raw = clean_str(broker_raw)
    if not raw:
        return (None, "Direct Purchase (No Broker)", True)
    for k, canonical in BROKER_MAP.items():
        if k in raw.lower():
            return (raw, canonical, raw != canonical)
    clean = " ".join([w.capitalize() for w in raw.split()])
    return (raw, clean, raw != clean)

def normalize_date(val: Any, fallback_val: Any = None) -> Tuple[Optional[str], List[str]]:
    """Handles excel corrupted date serials (e.g. 6693546.0 in rows 288-302)"""
    logs = []
    if val is None:
        if fallback_val:
            fallback_res, _ = normalize_date(fallback_val, None)
            logs.append(f"Primary date missing, used fallback {fallback_res}")
            return (fallback_res, logs)
        return (None, logs)
    
    if isinstance(val, (datetime.datetime, datetime.date)):
        return (val.strftime("%Y-%m-%d"), logs)
    
    s = str(val).strip()
    if s.startswith('#') or 'value' in s.lower() or 'div' in s.lower():
        if fallback_val:
            fallback_res, _ = normalize_date(fallback_val, None)
            logs.append(f"Corrupted date serial '{s}', fell back to {fallback_res}")
            return (fallback_res, logs)
        return (None, [f"Corrupted date serial '{s}'"])
    
    # Try parsing DD/MM/YYYY or YYYY-MM-DD
    for fmt in ["%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"]:
        try:
            dt = datetime.datetime.strptime(s, fmt)
            return (dt.strftime("%Y-%m-%d"), logs)
        except ValueError:
            continue
    
    # Check if numeric excel serial outside limits
    try:
        f = float(s)
        if f > 1000000:
            if fallback_val:
                fallback_res, _ = normalize_date(fallback_val, None)
                logs.append(f"Extreme date serial {f}, fell back to {fallback_res}")
                return (fallback_res, logs)
            return (None, [f"Extreme date serial {f}"])
        # Standard excel serial (days since 1899-12-30)
        dt = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=f)
        return (dt.strftime("%Y-%m-%d"), logs)
    except (ValueError, TypeError):
        pass

    return (None, [f"Unparseable date '{s}'"])

def validate_and_normalize_row(raw_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates and normalizes one row of 42 Costing transaction data.
    Stores raw values and normalized values for full auditable transparency.
    """
    audit_flags = []
    
    # GIN and GRN
    gin_orig = clean_str(raw_dict.get('gin'))
    grn_orig = clean_str(raw_dict.get('grn_no'))
    po_orig = clean_str(raw_dict.get('po_no'))
    
    # Dates
    gin_date_str, gin_date_logs = normalize_date(raw_dict.get('gin_date'))
    grn_date_str, grn_date_logs = normalize_date(raw_dict.get('grn_date'), fallback_val=gin_date_str)
    lab_date_str, lab_date_logs = normalize_date(raw_dict.get('lab_report_date'), fallback_val=gin_date_str)
    audit_flags.extend(gin_date_logs + grn_date_logs + lab_date_logs)
    
    # Station & Broker
    station_orig, station_norm, station_mod = normalize_station(raw_dict.get('station'))
    if station_mod and station_orig:
        audit_flags.append(f"Station normalized: '{station_orig}' -> '{station_norm}'")
        
    broker_orig, broker_norm, broker_mod = normalize_broker(raw_dict.get('broker_name'))
    if broker_mod and broker_orig:
        audit_flags.append(f"Broker normalized: '{broker_orig}' -> '{broker_norm}'")

    # Supplier
    supplier_code = clean_str(raw_dict.get('supplier_code'))
    supplier_name_orig = clean_str(raw_dict.get('supplier_name'))
    supplier_name = " ".join(supplier_name_orig.split()) if supplier_name_orig else "Unknown Supplier"
    
    # Supervisor
    supervisor_raw = clean_str(raw_dict.get('supervisor_name'))
    supervisor_name = " ".join([w.capitalize() for w in supervisor_raw.split()]) if supervisor_raw else "Unassigned"

    # Numeric Fields
    bill_wt = clean_float(raw_dict.get('bill_wt'))
    gross_wt = clean_float(raw_dict.get('gross_wt'))
    rec_wt = clean_float(raw_dict.get('rec_wt'))
    bill_amount = clean_float(raw_dict.get('bill_amount'))
    actual_rate = clean_float(raw_dict.get('actual_rate'))
    party_condition = clean_float(raw_dict.get('party_condition'))
    oil_manual = clean_float(raw_dict.get('oil_manual'))
    oil_analyzer = clean_float(raw_dict.get('oil_analyzer'))
    
    # Quality Parameters
    fm_raw = clean_float(raw_dict.get('fm'))
    greenish_raw = clean_float(raw_dict.get('greenish'))
    moisture_pre = clean_float(raw_dict.get('moisture_pre'))
    moisture_qc = clean_float(raw_dict.get('moisture_qc'))
    ffa = clean_float(raw_dict.get('ffa'))

    # Typo / Unit Auditing:
    # 1. Foreign Matter (FM) normalization (e.g. 0.0045 means 0.45%)
    fm_pct = fm_raw * 100.0 if (fm_raw is not None and fm_raw < 0.05) else fm_raw
    # 2. Greenish normalization (e.g. 0.047 means 4.70%)
    greenish_pct = greenish_raw * 100.0 if (greenish_raw is not None and greenish_raw < 0.10) else greenish_raw
    # 3. Moisture Pre normalization (0.059 means 5.9%)
    moist_pre_pct = moisture_pre * 100.0 if (moisture_pre is not None and moisture_pre < 0.20) else moisture_pre
    
    # 4. Moisture QC Outlier check (e.g. 455.0 typo in Row 502)
    moist_qc_orig = moisture_qc
    if moisture_qc is not None and moisture_qc > 20.0:
        audit_flags.append(f"Critical Typo Detected: Moisture In QC is {moisture_qc}%. Flagged as outlier.")
        # We don't overwrite blindly; we flag it and provide audit note
        moisture_qc_normalized = round(moisture_qc / 100.0, 2) if moisture_qc > 100 else moisture_qc
    else:
        moisture_qc_normalized = moisture_qc

    # Zero / Null Denominator Flag
    if oil_manual is None or oil_manual <= 0:
        audit_flags.append("Oil Manual is null or zero. 42 Cost marked LAB_PENDING.")

    return {
        "gin": gin_orig,
        "grn_no": grn_orig,
        "po_no": po_orig,
        "supervisor_name": supervisor_name,
        "supplier_code": supplier_code,
        "supplier_name": supplier_name,
        "station_original": station_orig,
        "station": station_norm,
        "broker_original": broker_orig,
        "broker_name": broker_norm,
        "gin_date": gin_date_str,
        "grn_date": grn_date_str,
        "lab_report_date": lab_date_str,
        "bill_wt": bill_wt,
        "rec_wt": rec_wt,
        "gross_wt": gross_wt,
        "bill_amount": bill_amount,
        "actual_rate": actual_rate,
        "party_condition": party_condition,
        "oil_manual": oil_manual,
        "oil_analyzer": oil_analyzer,
        "fm_raw": fm_raw,
        "fm_pct": fm_pct,
        "greenish_raw": greenish_raw,
        "greenish_pct": greenish_pct,
        "moisture_pre_pct": moist_pre_pct,
        "moisture_qc_raw": moist_qc_orig,
        "moisture_qc": moisture_qc_normalized,
        "ffa": ffa,
        "audit_flags": audit_flags,
        "has_issues": len(audit_flags) > 0
    }
