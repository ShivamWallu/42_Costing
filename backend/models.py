"""
Pydantic Data Models for Khandelia 42 Costing Platform API.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class TransactionItem(BaseModel):
    id: int
    gin: Optional[str] = None
    grn_no: Optional[str] = None
    po_no: Optional[str] = None
    supervisor_name: Optional[str] = None
    supplier_code: Optional[str] = None
    supplier_name: Optional[str] = None
    station: Optional[str] = None
    broker_name: Optional[str] = None
    gin_date: Optional[str] = None
    grn_date: Optional[str] = None
    lab_report_date: Optional[str] = None
    bill_wt: Optional[float] = None
    rec_wt: Optional[float] = None
    gross_wt: Optional[float] = None
    bill_amount: Optional[float] = None
    actual_rate: Optional[float] = None
    party_condition: Optional[float] = None
    condition_rate_42: Optional[float] = None
    oil_manual: Optional[float] = None
    oil_analyzer: Optional[float] = None
    cost_42: Optional[float] = None
    costing_status: Optional[str] = None
    costing_message: Optional[str] = None
    cost_diff: Optional[float] = None
    cost_diff_pct: Optional[float] = None
    impact_type: Optional[str] = None
    oil_diff_condition: Optional[float] = None
    oil_diff_analyzer: Optional[float] = None
    analyzer_cost_42: Optional[float] = None
    theoretical_oil_weight_qtl: Optional[float] = None
    fm_pct: Optional[float] = None
    greenish_pct: Optional[float] = None
    moisture_pre_pct: Optional[float] = None
    moisture_qc: Optional[float] = None
    ffa: Optional[float] = None
    is_anomaly: int = 0
    anomaly_score: float = 0.0
    anomaly_reasons: List[str] = []
    audit_flags: List[str] = []

class DashboardKpiResponse(BaseModel):
    total_records: int
    total_weight_qtl: float
    total_spend_inr: float
    avg_actual_rate: float
    avg_oil_manual: float
    avg_oil_analyzer: float
    avg_cost_42: float
    cost_impact_amount_inr: float
    cost_impact_pct: float
    total_net_ded_inr: float = 0.0
    quality_status_breakdown: Dict[str, int] = {}
    anomaly_count: int = 0
    loss_count: int = 0
    profit_count: int = 0
    neutral_count: int = 0
    pending_count: int = 0
    loss_pct: float = 0.0
    profit_pct: float = 0.0
    neutral_pct: float = 0.0
    pending_pct: float = 0.0
    total_rec_wt_qtl: float = 0.0
    total_rec_wt_mt: float = 0.0
    total_bill_wt_qtl: float = 0.0
    avg_landing_cost_qtl: float = 0.0

class FilterOptionsResponse(BaseModel):
    supervisors: List[str]
    suppliers: List[str]
    stations: List[str]
    brokers: List[str]
    min_date: Optional[str] = None
    max_date: Optional[str] = None
    min_rate: Optional[float] = None
    max_rate: Optional[float] = None
    min_oil: Optional[float] = None
    max_oil: Optional[float] = None

class FormulaTestRequest(BaseModel):
    actual_rate: float
    oil_manual: float
    party_condition: Optional[float] = 42.0
    bill_amount: Optional[float] = None
    bill_weight: Optional[float] = None

class FormulaTestResponse(BaseModel):
    benchmark: float = 42.0
    actual_rate: float
    oil_manual: float
    cost_42: Optional[float] = None
    step_by_step: List[str]
    cost_diff: Optional[float] = None
    cost_diff_pct: Optional[float] = None
    impact_type: str
    status: str
    explanation: str

class SyncRequest(BaseModel):
    sheet_id: Optional[str] = None
    gid: Optional[str] = "0"
