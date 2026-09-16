"""
42 Costing Engine for Khandelia Oil & General Mills Pvt. Ltd. (KOGM)
Benchmark Quality = 42.00% (Oil content standard for Mustard Seed)

Formulas:
1. Landing Cost MT = (Taxable Bill Amount - Net Deductions) / Received Weight (MT)
2. Landing Cost Qtl = Landing Cost MT / 10.0
3. 42% Costing MT = (Landing Cost MT / NIR Oil) * 42.0
4. 42% Costing Qtl = (Landing Cost Qtl / NIR Oil) * 42.0
5. Actual Purchase Rate (AT) = Bill Amount (AN) / Bill Weight (AI)
6. Actual 42 Adjusted Cost (AZ) = (Actual Purchase Rate / Oil Manual) * 42.0
"""

from typing import Optional, Dict, Any

BENCHMARK_OIL = 42.00

def calculate_actual_rate(bill_amount: Optional[float], bill_weight: Optional[float]) -> Optional[float]:
    """Computes Actual Purchase Rate (₹/Qtl) = Bill Amount / Bill Weight."""
    if bill_amount is None or bill_weight is None or bill_weight <= 0:
        return None
    return round(bill_amount / bill_weight, 4)

def calculate_condition_42_rate(actual_rate: Optional[float], party_condition: Optional[float]) -> Optional[float]:
    """Computes Condition 42 Rate (₹/Qtl) = (Actual Rate / Party Condition) * 42.0."""
    if actual_rate is None or party_condition is None or party_condition <= 0:
        return None
    return round((actual_rate / party_condition) * BENCHMARK_OIL, 4)

def calculate_landing_and_42_cost(
    taxable_amount: Optional[float],
    net_deductions: Optional[float] = 0.0,
    rec_wt_mt: Optional[float] = None,
    oil_nir: Optional[float] = None
) -> Dict[str, Any]:
    """
    Standard Enterprise Formula:
    Landing Cost MT = (Taxable Amount - Net Deductions) / Received Weight (MT)
    Landing Cost Qtl = Landing Cost MT / 10.0
    42% Costing MT = (Landing Cost MT / NIR Oil) * 42.0
    42% Costing Qtl = (Landing Cost Qtl / NIR Oil) * 42.0
    """
    ded = net_deductions if net_deductions is not None else 0.0
    
    if taxable_amount is None or taxable_amount <= 0:
        return {
            "landing_cost_mt": None,
            "landing_cost_qtl": None,
            "cost_42_mt": None,
            "cost_42_qtl": None,
            "status": "INVALID_AMOUNT",
            "message": "Taxable amount is missing or zero"
        }
        
    if rec_wt_mt is None or rec_wt_mt <= 0:
        return {
            "landing_cost_mt": None,
            "landing_cost_qtl": None,
            "cost_42_mt": None,
            "cost_42_qtl": None,
            "status": "INVALID_WEIGHT",
            "message": "Received weight is missing or zero"
        }
        
    net_amount = taxable_amount - ded
    landing_cost_mt = round(net_amount / rec_wt_mt, 2)
    landing_cost_qtl = round(landing_cost_mt / 10.0, 2)
    
    if oil_nir is None or oil_nir <= 0:
        return {
            "landing_cost_mt": landing_cost_mt,
            "landing_cost_qtl": landing_cost_qtl,
            "cost_42_mt": None,
            "cost_42_qtl": None,
            "status": "LAB_PENDING",
            "message": "NIR Oil test is pending or zero"
        }
        
    cost_42_mt = round((landing_cost_mt / oil_nir) * BENCHMARK_OIL, 2)
    cost_42_qtl = round((landing_cost_qtl / oil_nir) * BENCHMARK_OIL, 2)
    diff_mt = round(cost_42_mt - landing_cost_mt, 2)
    diff_qtl = round(cost_42_qtl - landing_cost_qtl, 2)
    
    return {
        "landing_cost_mt": landing_cost_mt,
        "landing_cost_qtl": landing_cost_qtl,
        "cost_42_mt": cost_42_mt,
        "cost_42_qtl": cost_42_qtl,
        "diff_mt": diff_mt,
        "diff_qtl": diff_qtl,
        "status": "VALID",
        "message": "Landing cost and 42 costing successfully calculated"
    }

def calculate_42_adjusted_cost(actual_rate: Optional[float], oil_manual: Optional[float]) -> Dict[str, Any]:
    """
    Computes 42 Adjusted Cost (₹/Qtl) = (Actual Rate / Oil Manual) * 42.0.
    Handles pending lab results, zero denominators, and extreme values safely.
    """
    if actual_rate is None or actual_rate <= 0:
        return {
            "cost_42": None,
            "status": "INVALID_RATE",
            "message": "Actual purchase rate is missing or zero"
        }
    
    if oil_manual is None or oil_manual <= 0:
        return {
            "cost_42": None,
            "status": "LAB_PENDING",
            "message": "Laboratory manual oil test is pending or zero"
        }
    
    if oil_manual < 25.0 or oil_manual > 55.0:
        cost = round((actual_rate / oil_manual) * BENCHMARK_OIL, 4)
        return {
            "cost_42": cost,
            "status": "QUALITY_OUTLIER",
            "message": f"Oil quality {oil_manual}% is outside standard range (25-55%)"
        }

    cost = round((actual_rate / oil_manual) * BENCHMARK_OIL, 4)
    return {
        "cost_42": cost,
        "status": "VALID",
        "message": "Costing successfully calculated"
    }

def calculate_cost_impact(actual_rate: Optional[float], cost_42: Optional[float]) -> Dict[str, Any]:
    """Calculates cost impact of seed quality."""
    if actual_rate is None or cost_42 is None or actual_rate <= 0:
        return {
            "cost_diff": None,
            "cost_diff_pct": None,
            "impact_type": "UNKNOWN"
        }
    
    diff = round(cost_42 - actual_rate, 2)
    diff_pct = round(((cost_42 - actual_rate) / actual_rate) * 100.0, 2)
    
    if diff > 0.05:
        impact_type = "COST_INFLATION"  # Quality < 42%
    elif diff < -0.05:
        impact_type = "COST_SAVING"     # Quality > 42%
    else:
        impact_type = "BENCHMARK_PARITY" # Quality == 42%
        
    return {
        "cost_diff": diff,
        "cost_diff_pct": diff_pct,
        "impact_type": impact_type
    }

def evaluate_full_transaction_costing(
    bill_amount: Optional[float],
    bill_weight: Optional[float],
    party_condition: Optional[float],
    oil_manual: Optional[float],
    oil_analyzer: Optional[float] = None,
    gross_weight: Optional[float] = None,
    override_actual_rate: Optional[float] = None
) -> Dict[str, Any]:
    """Comprehensive single-record evaluation returned to API and UI."""
    actual_rate = override_actual_rate if override_actual_rate is not None else calculate_actual_rate(bill_amount, bill_weight)
    condition_rate_42 = calculate_condition_42_rate(actual_rate, party_condition)
    
    # Priority on NIR oil if available, else manual
    primary_oil = oil_analyzer if (oil_analyzer is not None and oil_analyzer > 0) else oil_manual
    costing_res = calculate_42_adjusted_cost(actual_rate, primary_oil)
    cost_42 = costing_res["cost_42"]
    
    impact = calculate_cost_impact(actual_rate, cost_42)
    
    # Differences
    oil_diff_condition = round(primary_oil - party_condition, 2) if (primary_oil is not None and party_condition is not None) else None
    oil_diff_analyzer = round(oil_manual - oil_analyzer, 2) if (oil_manual is not None and oil_analyzer is not None) else None
    
    # Analyzer 42 cost for comparison
    analyzer_cost_42 = round((actual_rate / oil_analyzer) * BENCHMARK_OIL, 4) if (actual_rate and oil_analyzer and oil_analyzer > 0) else None
    
    # Pure theoretical oil weight (Qtl)
    oil_weight_qtl = round((gross_weight * primary_oil / 100.0), 4) if (gross_weight is not None and primary_oil is not None) else None

    return {
        "actual_rate": actual_rate,
        "party_condition": party_condition,
        "condition_rate_42": condition_rate_42,
        "oil_manual": oil_manual,
        "oil_analyzer": oil_analyzer,
        "cost_42": cost_42,
        "costing_status": costing_res["status"],
        "costing_message": costing_res["message"],
        "cost_diff": impact["cost_diff"],
        "cost_diff_pct": impact["cost_diff_pct"],
        "impact_type": impact["impact_type"],
        "oil_diff_condition": oil_diff_condition,
        "oil_diff_analyzer": oil_diff_analyzer,
        "analyzer_cost_42": analyzer_cost_42,
        "theoretical_oil_weight_qtl": oil_weight_qtl
    }
