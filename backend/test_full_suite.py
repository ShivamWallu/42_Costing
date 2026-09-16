"""
Comprehensive Automated Verification Suite for Khandelia 42 Costing Platform.
Tests mathematical formulas, NIR oil calculations, anomaly thresholds,
supplier rankings, weekly breakdowns, location analytics, and SMTP email service.
"""

import sys
import os
import unittest
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from costing_engine import calculate_landing_and_42_cost, calculate_42_adjusted_cost, calculate_actual_rate
from ml_analytics import (
    run_anomaly_detection, get_3day_benchmark, get_top_supplier_rankings,
    get_weekly_supplier_breakdown, get_location_supplier_breakdown,
    get_no_bargain_supplier_alerts
)
from email_service import get_weekly_report_data, generate_weekly_report_html
from database import get_db_connection

class TestCostingEngineFormulas(unittest.TestCase):
    
    def test_exact_landing_and_42_cost_calculation(self):
        """
        Verify:
        Taxable Amt = 1,749,277.90
        Net Ded = 0.00
        Rec Wt = 25.65 MT (= 256.50 Qtl)
        Oil NIR = 41.14%
        Landing Cost MT = 1,749,277.90 / 25.65 = 68,197.97
        Landing Cost Qtl = 68,197.97 / 10.0 = 6,819.80
        42 Cost MT = (68,197.97 / 41.14) * 42.0 = 69,623.59
        42 Cost Qtl = (6,819.80 / 41.14) * 42.0 = 6,962.36
        """
        res = calculate_landing_and_42_cost(
            taxable_amount=1749277.90,
            net_deductions=0.0,
            rec_wt_mt=25.65,
            oil_nir=41.14
        )
        
        self.assertEqual(res["status"], "VALID")
        self.assertAlmostEqual(res["landing_cost_mt"], 68197.97, places=1)
        self.assertAlmostEqual(res["landing_cost_qtl"], 6819.80, places=1)
        self.assertAlmostEqual(res["cost_42_mt"], 69623.59, places=1)
        self.assertAlmostEqual(res["cost_42_qtl"], 6962.36, places=1)

    def test_deduction_subtraction_landing_cost(self):
        """
        Verify deduction is subtracted before dividing by weight:
        Taxable Amt = 2,062,360
        Net Ded = 6,999
        Net Amt = 2,055,361
        Rec Wt = 30.02 MT
        Landing Cost MT = 2,055,361 / 30.02 = 68,466.39
        Landing Cost Qtl = 6,846.64
        Oil NIR = 40.17%
        42 Cost MT = (68,466.39 / 40.17) * 42.0 = 71,586.88
        """
        res = calculate_landing_and_42_cost(
            taxable_amount=2062360.0,
            net_deductions=6999.0,
            rec_wt_mt=30.02,
            oil_nir=40.17
        )
        
        self.assertEqual(res["status"], "VALID")
        self.assertAlmostEqual(res["landing_cost_mt"], 68466.39, places=1)
        self.assertAlmostEqual(res["landing_cost_qtl"], 6846.64, places=1)
        self.assertAlmostEqual(res["cost_42_mt"], 71585.47, places=1)
        self.assertAlmostEqual(res["cost_42_qtl"], 7158.55, places=1)

    def test_pending_oil_safety(self):
        """Zero or null oil must return LAB_PENDING status cleanly."""
        res = calculate_landing_and_42_cost(
            taxable_amount=100000.0,
            net_deductions=0.0,
            rec_wt_mt=15.0,
            oil_nir=None
        )
        self.assertEqual(res["status"], "LAB_PENDING")
        self.assertIsNone(res["cost_42_mt"])

class TestAnalyticsAndRankings(unittest.TestCase):

    def test_anomaly_detection_execution(self):
        """Anomaly detection must flag transactions with Oil < 39%, Moisture > 6%, FM > 5%."""
        res = run_anomaly_detection()
        self.assertIn("flagged", res)
        self.assertGreater(res["flagged"], 0)
        self.assertEqual(res["total"], 1892)

    def test_top_supplier_rankings(self):
        """Rankings must return both highest oil and best value (lowest 42 cost) lists."""
        rankings = get_top_supplier_rankings(limit=5)
        self.assertIn("highest_oil_suppliers", rankings)
        self.assertIn("best_value_suppliers", rankings)
        self.assertGreater(len(rankings["highest_oil_suppliers"]), 0)
        self.assertGreater(len(rankings["best_value_suppliers"]), 0)
        
        # Verify ordering: Highest oil first
        highest = rankings["highest_oil_suppliers"]
        self.assertGreaterEqual(highest[0]["avg_oil_nir"], highest[-1]["avg_oil_nir"])
        
        # Verify ordering: Lowest 42 cost first
        best = rankings["best_value_suppliers"]
        self.assertLessEqual(best[0]["avg_cost_42_qtl"], best[-1]["avg_cost_42_qtl"])

    def test_3day_benchmark(self):
        """3-day benchmark must return average rate, oil, and cost for 3 active dates."""
        bm = get_3day_benchmark()
        self.assertIn("avg_rate", bm)
        self.assertIn("avg_cost_42", bm)
        self.assertIn("dates", bm)
        self.assertLessEqual(len(bm["dates"]), 3)

    def test_weekly_supplier_breakdown(self):
        """Weekly breakdown must return week-aggregated supplier performance."""
        weekly = get_weekly_supplier_breakdown()
        self.assertIsInstance(weekly, list)
        if len(weekly) > 0:
            self.assertIn("week_num", weekly[0])
            self.assertIn("supplier_name", weekly[0])
            self.assertIn("avg_cost_42_qtl", weekly[0])

    def test_location_supplier_breakdown(self):
        """Location breakdown must group metrics by mandi / station."""
        locs = get_location_supplier_breakdown()
        self.assertIsInstance(locs, list)
        if len(locs) > 0:
            self.assertIn("station", locs[0])
            self.assertIn("avg_oil", locs[0])

    def test_dormant_supplier_alerts(self):
        """Must identify past suppliers with no active bargains in recent period."""
        alerts = get_no_bargain_supplier_alerts(dormancy_days=14)
        self.assertIsInstance(alerts, list)
        if len(alerts) > 0:
            self.assertIn("alert_reason", alerts[0])
            self.assertIn("supplier_name", alerts[0])

class TestEmailReportEngine(unittest.TestCase):

    def test_weekly_report_data_and_html_generation(self):
        """Report data extraction and HTML generation must succeed and contain all key sections."""
        data = get_weekly_report_data()
        self.assertIn("kpis", data)
        self.assertIn("top_oil_suppliers", data)
        self.assertIn("best_value_suppliers", data)
        
        html = generate_weekly_report_html(data)
        self.assertIn("Khandelia Oil & General Mills Pvt. Ltd.", html)
        self.assertIn("Top Suppliers by Highest Oil %", html)
        self.assertIn("Top Best-Value Suppliers", html)

if __name__ == "__main__":
    unittest.main()
