"""
Migration and Recalculation Script:
Accurately reconciles and recalculates Landing Cost, 42% Standard Cost, and Rate Variance
for all Multi-PO GIN trucks across Neon PostgreSQL and SQLite using Pro-Rata Weight Allocation.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import get_db_connection, is_postgres
from collections import defaultdict
import json

def run_multi_po_reconciliation():
    conn = get_db_connection()
    cursor = conn.cursor()
    print(f"[RECONCILIATION] Connected to database (is_postgres={is_postgres()})...")

    # 1. Fetch all debit note records
    cursor.execute("""
        SELECT id, s_no, gin, po_no, supplier_name, bill_wt_qtl, rec_wt_qtl, billed_rate_qtl, 
               debit_amt_y, net_ded, landing_cost_qtl, cost_42_qtl, rate_diff_qtl, oil_nir, status, remarks
        FROM debit_note_records
        ORDER BY s_no
    """)
    all_rows = cursor.fetchall()
    print(f"[RECONCILIATION] Total lots in database: {len(all_rows)}")

    # 2. Group by GIN
    gin_groups = defaultdict(list)
    for r in all_rows:
        gin_groups[r['gin']].append(dict(r))

    multi_po_gins = {g: rows for g, rows in gin_groups.items() if len(rows) > 1}
    print(f"[RECONCILIATION] Found {len(multi_po_gins)} Multi-PO GIN trucks ({sum(len(v) for v in multi_po_gins.values())} lots).")

    updated_count = 0

    for gin, rows in multi_po_gins.items():
        # Clean special case like row 855 typo in raw sheet if bill_wt was 762 instead of 76.2
        # Check sum of bill_wt
        cleaned_rows = []
        for r in rows:
            b_wt = r['bill_wt_qtl']
            b_amt = r['debit_amt_y']
            b_rate = r['billed_rate_qtl']
            # If b_wt * b_rate is ~10x off from b_amt, adjust b_wt
            if b_rate > 0 and b_amt > 0:
                calc_amt = b_wt * b_rate
                if calc_amt > b_amt * 8.0 and (b_wt / 10.0) * b_rate > b_amt * 0.9 and (b_wt / 10.0) * b_rate < b_amt * 1.1:
                    b_wt = round(b_wt / 10.0, 2)
            cleaned_rows.append((r, b_wt))

        # Check if raw rec_wt was already split per row or repeated
        sum_rec_wt = sum(r['rec_wt_qtl'] for r, _ in cleaned_rows)
        max_rec_wt = max(r['rec_wt_qtl'] for r, _ in cleaned_rows)
        sum_bill_wt = sum(b_wt for _, b_wt in cleaned_rows)
        truck_rec_wt = sum_rec_wt if abs(sum_rec_wt - sum_bill_wt) < abs(max_rec_wt - sum_bill_wt) else max_rec_wt

        for r, b_wt in cleaned_rows:
            ratio = b_wt / sum_bill_wt if sum_bill_wt > 0 else (1.0 / len(rows))
            alloc_rec_wt_qtl = round(ratio * truck_rec_wt, 2)
            alloc_rec_wt_mt = round(alloc_rec_wt_qtl / 10.0, 4)

            bill_amt = r['debit_amt_y'] or 0.0
            net_ded = r['net_ded'] or 0.0
            billed_rate_qtl = r['billed_rate_qtl'] or (round(bill_amt / b_wt, 2) if b_wt > 0 else 0.0)
            billed_rate_mt = round(billed_rate_qtl * 10.0, 2)

            # Pro-rata deduction if net_ded was at truck level or PO level
            new_landing_mt = round((bill_amt - net_ded) / alloc_rec_wt_mt, 2) if alloc_rec_wt_mt > 0 else billed_rate_mt
            new_landing_qtl = round(new_landing_mt / 10.0, 2)

            oil = r['oil_nir']
            if oil and oil > 0:
                new_cost_42_mt = round((new_landing_mt / oil) * 42.0, 2)
                new_cost_42_qtl = round(new_cost_42_mt / 10.0, 2)
                new_diff_mt = round(new_cost_42_mt - new_landing_mt, 2)
                new_diff_qtl = round(new_cost_42_qtl - new_landing_qtl, 2)
                new_rate_diff_qtl = round(new_cost_42_qtl - billed_rate_qtl, 2)
                new_rate_diff_mt = round(new_rate_diff_qtl * 10.0, 2)
            else:
                new_cost_42_mt = None
                new_cost_42_qtl = None
                new_diff_mt = None
                new_diff_qtl = None
                new_rate_diff_qtl = None
                new_rate_diff_mt = None

            # Append remarks note
            old_rem = r['remarks'] or ''
            split_note = f"Multi-PO Truck Split (Truck Rec: {truck_rec_wt:.1f} Qtl, Alloc: {alloc_rec_wt_qtl:.1f} Qtl)"
            if split_note not in old_rem:
                new_rem = f"{split_note} | {old_rem}" if old_rem else split_note
            else:
                new_rem = old_rem

            # Update debit_note_records
            cursor.execute("""
                UPDATE debit_note_records
                SET bill_wt_qtl = ?,
                    rec_wt_qtl = ?,
                    rec_wt_mt = ?,
                    billed_rate_qtl = ?,
                    billed_rate_mt = ?,
                    landing_cost_mt = ?,
                    landing_cost_qtl = ?,
                    cost_42_mt = ?,
                    cost_42_qtl = ?,
                    diff_mt = ?,
                    diff_qtl = ?,
                    rate_diff_qtl = ?,
                    rate_diff_mt = ?,
                    final_effective_cost_mt = ?,
                    remarks = ?
                WHERE id = ?
            """, (
                b_wt,
                alloc_rec_wt_qtl,
                alloc_rec_wt_mt,
                billed_rate_qtl,
                billed_rate_mt,
                new_landing_mt,
                new_landing_qtl,
                new_cost_42_mt,
                new_cost_42_qtl,
                new_diff_mt,
                new_diff_qtl,
                new_rate_diff_qtl,
                new_rate_diff_mt,
                new_cost_42_mt,
                new_rem,
                r['id']
            ))

            # Update corresponding transaction in transactions table if present
            cursor.execute("""
                UPDATE transactions
                SET bill_wt = ?,
                    rec_wt = ?,
                    gross_wt = ?,
                    actual_rate = ?,
                    cost_42 = ?,
                    cost_diff = ?,
                    cost_diff_pct = ?,
                    impact_type = ?
                WHERE gin = ? AND po_no = ?
            """, (
                b_wt,
                alloc_rec_wt_qtl,
                truck_rec_wt,
                billed_rate_qtl,
                new_cost_42_qtl or billed_rate_qtl,
                new_rate_diff_qtl or 0.0,
                round(((new_rate_diff_qtl or 0.0) / billed_rate_qtl) * 100.0, 2) if billed_rate_qtl > 0 else 0.0,
                "LOSS" if (new_rate_diff_qtl and new_rate_diff_qtl > 0) else "PROFIT",
                gin,
                r['po_no']
            ))

            updated_count += 1

    conn.commit()
    conn.close()
    print(f"[RECONCILIATION] Successfully reconciled and updated {updated_count} Multi-PO lots!")

if __name__ == "__main__":
    run_multi_po_reconciliation()
