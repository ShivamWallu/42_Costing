# Khandelia Oil & General Mills Pvt. Ltd. (KOGM)
# 42 Costing & Seed Quality AI Analytics Platform

Production-grade Python + AI/ML Full-Stack Analytics Platform for **Khandelia Oil & General Mills Pvt. Ltd., Chandigarh** (Makers of **Mashal Kachi Ghani Mustard Oil**).

Directly connects with daily-updated Google Sheets or XLSX datasets to provide auditable **42 Costing calculations**, laboratory quality audits, multi-dimensional AI anomaly detection, and executive management dashboards.

---

## 📑 Table of Contents
1. [Overview & Business Context](#-overview--business-context)
2. [Tech Stack](#-tech-stack)
3. [Project Directory Structure](#-project-directory-structure)
4. [Step-by-Step Setup & How to Start](#-step-by-step-setup--how-to-start)
   - [Prerequisites](#1-prerequisites)
   - [Method A: Running with Git Bash](#method-a-running-with-git-bash-recommended)
   - [Method B: Running with Windows PowerShell / CMD](#method-b-running-with-windows-powershell--cmd)
5. [Database Setup & Data Ingestion](#-database-setup--data-ingestion)
6. [Common Issues & Troubleshooting (Error Fixes)](#-common-issues--troubleshooting)
7. [42 Costing Formula & Calculation Proof](#-42-costing-formula--calculation-proof)
8. [Core Modules & Features](#-core-modules--features)
9. [API Endpoints Reference](#-api-endpoints-reference)
10. [Google Sheets Live Sync Guide](#-google-sheets-live-sync-guide)
11. [Vercel Cloud Deployment](#-vercel-cloud-deployment)

---

## 🏢 Overview & Business Context

In mustard seed oil manufacturing, the standard trading oil benchmark is **42.00%**. 
- When mustard seed arrives from different Mandis/Suppliers with varying oil percentages (e.g. 38.5%, 41.2%, 43.0%), purchase rates must be normalized to a standard **42% Oil Basis**.
- This platform calculates the true manufacturing landing cost (**42 Adjusted Cost**), audits supplier lab reports, detects anomalies using AI/ML, and syncs live with Google Sheets.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.10+, FastAPI, Uvicorn, SQLite3, Pandas, NumPy, Scikit-learn (Isolation Forest)
- **Frontend**: HTML5, Vanilla CSS3 (Custom Glassmorphic Theme), JavaScript (ES6+), Chart.js
- **Data Ingestion**: OpenPyXL, Pandas, Requests (Google Sheets CSV Stream API)
- **Deployment**: Vercel Serverless (`vercel.json`) / Local Host

---

## 📁 Project Directory Structure

```text
42_Costing/
├── backend/
│   ├── main.py                  # FastAPI server routes, middleware & static mount
│   ├── costing_engine.py        # Core 42-Costing mathematical calculation engine
│   ├── database.py              # SQLite connection & schema initializer
│   ├── ingestion.py             # Parses Excel/CSV records and populates SQLite
│   ├── ml_analytics.py          # Isolation Forest anomaly detection & AI insights
│   ├── models.py                # Pydantic request/response data schemas
│   ├── validator.py             # Data quality checks & outlier cleaning
│   ├── google_sheets_sync.py    # Live Google Sheets reconciliation engine
│   ├── populate_debit_db.py     # Debit note laboratory cost parser
│   ├── test_engine.py           # Automated unit test suite
│   └── khandelia_costing.db     # SQLite database storing transactions & audits
├── frontend/
│   ├── index.html               # Single-Page Application dashboard UI
│   ├── css/
│   │   └── style.css            # Custom responsive styles & theme tokens
│   ├── js/
│   │   └── app.js               # Frontend controller, API calls & Chart.js logic
│   └── images/
│       └── mashal_logo_2.jpg    # Brand logo
├── Debit_Note_Sheet/            # Debit note excel spreadsheets
├── requirements.txt             # Python dependencies
├── vercel.json                  # Vercel deployment configuration
└── README.md                    # Complete project documentation
```

---

## 🚀 Step-by-Step Setup & How to Start

### 1. Prerequisites
- **Python 3.10 or higher** installed on your system.
- Check Python version:
  ```bash
  python --version
  ```

---

### Method A: Running with Git Bash (Recommended)

1. **Open Git Bash** and navigate to the project directory:
   ```bash
   cd /d/42_Costing
   ```

2. **Activate Virtual Environment**:
   ```bash
   source venv/Scripts/activate
   ```
   *(Aapko terminal prompt ke aage `(venv)` dikhega)*

3. **Install Dependencies (Only first time)**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Start the FastAPI & Dashboard Server**:
   ```bash
   python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   ```

5. **Open in Browser**:
   👉 **`http://127.0.0.1:8000/`**

---

### Method B: Running with Windows PowerShell / CMD

1. **Open PowerShell** as Administrator or Normal User:
   ```powershell
   cd d:\42_Costing
   ```

2. **Activate Virtual Environment**:
   ```powershell
   .\venv\Scripts\activate
   ```

3. **Run the Uvicorn Server**:
   ```powershell
   python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   ```

4. **Open in Browser**:
   👉 **`http://127.0.0.1:8000/`**

---

## 🗄️ Database Setup & Data Ingestion

Agar database file (`khandelia_costing.db`) delete ho gayi ho ya new Excel data re-import karna ho:

1. **Ingest Main 42 Costing Excel / CSV**:
   ```bash
   python backend/ingestion.py
   ```
   *Ye script 1,895+ records parse karti hai, 42 Costing calculate karti hai, aur ML anomaly detect karti hai.*

2. **Ingest Debit Note Sheet Data**:
   ```bash
   python backend/populate_debit_db.py
   ```

3. **Run Automated Unit Tests**:
   ```bash
   python backend/test_engine.py
   ```

---

## ⚠️ Common Issues & Troubleshooting

### 1. Error: `[WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions`
- **Cause**: Port 8000 pehle se kisi process (jaise background server) dwara use ho raha hai.
- **Solution**:
  - **Option 1**: Port 8000 par chal rahe process ko band karein:
    ```powershell
    # PowerShell me check karein
    Get-Process -Id (Get-NetTCPConnection -LocalPort 8000).OwningProcess | Stop-Process -Force
    ```
  - **Option 2**: Server ko kisi doosre port (e.g., 8080 ya 8001) par run karein:
    ```bash
    python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 --reload
    ```
    *(Fir browser me `http://127.0.0.1:8080/` kholein)*

### 2. Error: `ModuleNotFoundError: No module named 'fastapi'`
- **Cause**: Virtual environment activate nahi hua hai ya packages install nahi hain.
- **Solution**:
  ```bash
  source venv/Scripts/activate
  pip install -r requirements.txt
  ```

---

## 📊 42 Costing Formula & Calculation Proof

### Verified Standard Formula:
$$\text{42 Adjusted Cost (₹/Qtl)} = \left(\frac{\text{Actual Purchase Rate (₹/Qtl)}}{\text{Laboratory Oil Quality (\%)}} \right) \times 42.00$$

### Key Variables:
| Variable | Excel Column | Description |
| :--- | :--- | :--- |
| **Actual Purchase Rate (AT)** | `Col AT` | Calculated as `Bill Amount (AN) ÷ Bill Weight (AI)`. Rate in ₹/Quintal. |
| **Actual Oil Quality (AW)** | `Col AW` | Laboratory manual chemical extraction percentage (Gold standard). |
| **Party Condition (AV)** | `Col AV` | Base oil % agreed in the purchase contract with the supplier. |
| **Condition 42 Rate (AU)** | `Col AU` | Base rate normalized to 42%: `(Actual Rate ÷ Party Condition) × 42`. |
| **42 Costing on Oil Manual (AZ)**| `Col AZ` | True effective cost: `(Actual Rate ÷ Oil Manual) × 42`. |

### Edge Case Handling:
- Agar Lab result pending ho (`oil_manual = NULL` ya `0`), toh system safely `LAB_PENDING` assign karta hai bina crash hue.
- **Net Quality Impact**:
  $$\text{Impact (₹)} = (\text{Actual Rate} - \text{42 Adjusted Cost}) \times \text{Weight}$$

---

## 🌟 Core Modules & Features

1. **Executive Owner Dashboard**:
   - Live KPI cards: Total Inward Volume (MT), Total Spend (₹), Average Rate, Average Lab Oil %, 42-Adjusted Cost, and Net Quality Impact.
   - Dual-axis interactive trend chart (Rate vs 42 Cost over time).
   - Top Supplier performance rankings & Mandi quality comparisons.

2. **Operational Data Hub (Data Register)**:
   - Full tabular view of 1,895+ transactions.
   - Dynamic multi-filter: Supervisor, Supplier, Station, Date Range, Anomaly only, and Lab Pending only.
   - Sortable columns and pagination.
   - Single-click **CSV Data Export**.

3. **Lot Audit Modal & Mathematical Proof**:
   - Click on any lot to see complete step-by-step mathematical proof, lab quality metrics, and anomaly status.

4. **Seed Quality & Lab Analytics**:
   - Chemical Manual Extraction (Col AW) vs Optical NIR Analyzer (Col AX) comparison.
   - Oil percentage distribution histogram with a 42.00% benchmark line.
   - Moisture, Foreign Matter (FM), Greenish seed, and Free Fatty Acids (FFA) tracking.

5. **AI / ML Anomaly Detection Engine**:
   - Isolation Forest unsupervised ML model + statistical boundary rules.
   - Flags suspicious lots (high rate with poor oil, abnormal moisture, lab discrepancy).
   - Plain-language explainable reason tags for management audit.

6. **Interactive "What-If" Calculator**:
   - Real-time simulation tool to test rate and oil variations and instantly compute 42 Costing.

---

## 🔌 API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves the main Frontend Single-Page Application |
| `GET` | `/api/dashboard/kpis` | Summary metrics (Volume, Spend, Avg Rate, 42 Cost) |
| `GET` | `/api/records` | Paginated records with multi-column filtering |
| `GET` | `/api/records/{id}` | Detailed single transaction audit |
| `GET` | `/api/filters/options` | Dynamic dropdown values for filters |
| `GET` | `/api/analytics/trends` | Date-wise Rate vs 42 Cost trend data |
| `GET` | `/api/analytics/suppliers` | Supplier cost-efficiency analysis |
| `GET` | `/api/analytics/stations` | Mandi/Station volume & quality comparison |
| `GET` | `/api/ai/anomalies` | List of AI flagged transactions |
| `GET` | `/api/ai/insights` | Auto-generated plain English AI insights |
| `POST` | `/api/formula/verify` | What-If simulation calculation endpoint |
| `POST` | `/api/sync/google-sheet` | Trigger live Google Sheet re-sync |

---

## ☁️ Google Sheets Live Sync Guide

1. Open your live Google Sheet.
2. Share sheet setting: *"Anyone with the link can view"*.
3. Copy the **Sheet ID** from your URL:
   `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
4. Dashboard ke **Google Sheets Sync** tab mein Sheet ID paste karein aur **"Sync Live Google Sheet Now"** par click karein.
5. Naye records automatically database mein ingest honge aur 42 Costing recalculate ho jayegi.

---

## 🚀 Vercel Cloud Deployment

1. Repository ko GitHub par push karein:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - 42 Costing Platform"
   git remote add origin <YOUR_GITHUB_REPO_URL>
   git push -u origin main
   ```
2. [Vercel](https://vercel.com) par jaayein aur repo import karein:
   - Framework Preset: `Other`
   - Root Directory: `./`
3. Environment Variable add karein (Optional):
   - `GOOGLE_SHEET_ID`: `<YOUR_SHEET_ID>`
4. Click **Deploy**. Vercel `vercel.json` ke through FastAPI aur Frontend ko automatically deploy kar dega.
