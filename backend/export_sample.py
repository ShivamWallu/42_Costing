import sqlite3
import json

conn = sqlite3.connect('d:/42_Costing/backend/khandelia_costing.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT * FROM transactions WHERE costing_status = 'VALID' LIMIT 1")
t = dict(cur.fetchone())

cur.execute("SELECT * FROM debit_note_records LIMIT 1")
d = dict(cur.fetchone())

with open('d:/42_Costing/backend/sample_records.json', 'w') as f:
    json.dump({'transaction': t, 'debit_note': d}, f, indent=2)

print("Sample records exported successfully.")
