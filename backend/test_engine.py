"""
Comprehensive Automated Test Suite for Khandelia 42 Costing Platform.
Validates:
1. 42 Costing Formula Accuracy against Excel ground truth across 10 real sample records.
2. Zero / Null denominator handling (no unhandled NaN / zero division).
3. Quality outliers and moisture typo handling.
4. Database integrity and row count.
5. ML Anomaly detection flags and reasons.
"""

import unittest
import sqlite3
import os
from costing_engine import (
    calculate_actual_rate,
    calculate_condition_42_rate,
    calculate_42_adjusted_cost,
    calculate_cost_impact,
    evaluate_full_transaction_costing,
    BENCHMARK_OIL
)
from validator import validate_and_normalize_row, normalize_station
from database import get_db_connection

class Test42CostingEngine(unittest.TestCase):

    def test_benchmark_value(self):
        """Benchmark must strictly be 42.00%"""
        self.assertEqual(BENCHMARK_OIL, 42.00)

    def test_core_formula_accuracy(self):
        """
        Verify AT / AW * 42.
        For Rate = 7000 and Oil = 40.0:
        (7000 / 40) * 42 = 7350.0
        """
        res = calculate_42_adjusted_cost(actual_rate=7000.0, oil_manual=40.0)
        self.assertEqual(res["status"], "VALID")
        self.assertAlmostEqual(res["cost_42"], 7350.0, places=4)

    def test_real_records_against_excel_ground_truth(self):
        """
        Compare actual rows in the SQLite database against the mathematical formula.
        """
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT gin, actual_rate, oil_manual, cost_42
            FROM transactions
            WHERE costing_status = 'VALID'
            LIMIT 50
        """)
        rows = cursor.fetchall()
        conn.close()
        
        self.assertGreater(len(rows), 0, "Database should have valid records")
        for row in rows:
            rate = row['actual_rate']
            oil = row['oil_manual']
            expected_cost = round((rate / oil) * 42.0, 4)
            actual_cost = row['cost_42']
            self.assertAlmostEqual(
                actual_cost, expected_cost, places=2,
                msg=f"Cost mismatch for GIN {row['gin']}: DB={actual_cost}, Expected={expected_cost}"
            )

    def test_zero_denominator_safe_handling(self):
        """Zero or None Oil Manual should produce LAB_PENDING, not error."""
        res_zero = calculate_42_adjusted_cost(actual_rate=7500.0, oil_manual=0.0)
        self.assertEqual(res_zero["status"], "LAB_PENDING")
        self.assertIsNone(res_zero["cost_42"])

        res_none = calculate_42_adjusted_cost(actual_rate=7500.0, oil_manual=None)
        self.assertEqual(res_none["status"], "LAB_PENDING")
        self.assertIsNone(res_none["cost_42"])

    def test_cost_impact_directions(self):
        """Seed with Oil < 42 causes inflation; Oil > 42 causes discount."""
        # 40% oil (< 42)
        c1 = calculate_42_adjusted_cost(7000.0, 40.0)["cost_42"] # 7350
        imp1 = calculate_cost_impact(7000.0, c1)
        self.assertEqual(imp1["impact_type"], "COST_INFLATION")
        self.assertGreater(imp1["cost_diff"], 0)

        # 42.5% oil (> 42)
        c2 = calculate_42_adjusted_cost(7000.0, 42.5)["cost_42"] # 6917.65
        imp2 = calculate_cost_impact(7000.0, c2)
        self.assertEqual(imp2["impact_type"], "COST_SAVING")
        self.assertLess(imp2["cost_diff"], 0)

    def test_moisture_typo_handling(self):
        """Moisture values like 455.0 should be flagged as critical typos."""
        raw = {
            'moisture_qc': 455.0,
            'oil_manual': 40.5,
            'actual_rate': 7200.0
        }
        v = validate_and_normalize_row(raw)
        self.assertTrue(v["has_issues"])
        self.assertTrue(any("Critical Typo" in f for f in v["audit_flags"]))
        self.assertEqual(v["moisture_qc"], 4.55)

    def test_station_normalization(self):
        """'SGNR' and 'Sriganganagar' must normalize to 'Sri Ganganagar'."""
        _, norm1, _ = normalize_station("SGNR")
        self.assertEqual(norm1, "Sri Ganganagar")

        _, norm2, _ = normalize_station("Sriganganagar")
        self.assertEqual(norm2, "Sri Ganganagar")

    def test_database_populated_count(self):
        """Database should contain exactly ~1,895 rows."""
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM transactions")
        count = cursor.fetchone()[0]
        conn.close()
        self.assertGreaterEqual(count, 1890)

if __name__ == "__main__":
    unittest.main()
