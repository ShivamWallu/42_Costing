"""
Automated Email Service for Khandelia 42 Costing & Seed Quality AI Platform.
Sends weekly executive reports and alerts using Gmail SMTP.
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import sqlite3
import os
from typing import Dict, Any, List, Optional
import datetime
from database import get_db_connection, is_postgres

import json
import urllib.request
import urllib.error

# SMTP Configuration
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "itchd.kogm@gmail.com")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "otiuncukbgbskxfk")
EMAIL_FROM = os.getenv("EMAIL_FROM", "itchd.kogm@gmail.com")
DEFAULT_TEST_EMAIL = os.getenv("TEST_EMAIL", "khandelia@yopmail.com")

# HTTPS Webhook & API Relays (Bypasses Render Free Tier raw SMTP port 587 block)
GMAIL_WEBHOOK_URL = os.getenv("GMAIL_WEBHOOK_URL", "https://script.google.com/macros/s/AKfycbzh5OuK7ZDEqF4mN6EHcX25q4EA-JZq6njv3uzrnCH8SsxLFS4HNqvl3Q2w74A56HNaiw/exec")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")

DB_PATH = os.path.join(os.path.dirname(__file__), "khandelia_costing.db")

def get_weekly_report_data() -> Dict[str, Any]:
    """Extracts aggregated KPI, rankings, anomalies and dormancy alerts for the weekly report."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Overall KPIs from debit_note_records
    cursor.execute("""
        SELECT 
            COUNT(*) as total_lots,
            ROUND(SUM(rec_wt_mt), 2) as total_wt_mt,
            ROUND(SUM(taxable_amt_an), 2) as total_taxable_amt,
            ROUND(SUM(net_ded), 2) as total_net_ded,
            ROUND(AVG(oil_nir), 2) as avg_oil_nir,
            ROUND((SUM(taxable_amt_an) - SUM(net_ded)) / SUM(rec_wt_mt), 2) as avg_landing_cost_mt,
            ROUND(((SUM(taxable_amt_an) - SUM(net_ded)) / SUM(rec_wt_mt)) / 10.0, 2) as avg_landing_cost_qtl,
            ROUND((((SUM(taxable_amt_an) - SUM(net_ded)) / SUM(rec_wt_mt)) / AVG(oil_nir)) * 42.0, 2) as avg_cost_42_mt,
            ROUND(((((SUM(taxable_amt_an) - SUM(net_ded)) / SUM(rec_wt_mt)) / 10.0) / AVG(oil_nir)) * 42.0, 2) as avg_cost_42_qtl
        FROM debit_note_records
        WHERE rec_wt_mt > 0 AND oil_nir > 0
    """)
    kpi_row = cursor.fetchone()
    kpis = dict(kpi_row) if kpi_row else {}

    # 2. Top 5 Highest Oil Suppliers
    cursor.execute("""
        SELECT supplier_name, COUNT(*) as lot_count, ROUND(SUM(rec_wt_mt), 2) as total_mt,
               ROUND(AVG(oil_nir), 2) as avg_oil,
               ROUND(AVG(landing_cost_qtl), 2) as avg_landing_qtl,
               ROUND(AVG(cost_42_qtl), 2) as avg_cost_42_qtl
        FROM debit_note_records
        WHERE rec_wt_mt > 0 AND oil_nir > 0
        GROUP BY supplier_name
        ORDER BY avg_oil DESC
        LIMIT 5
    """)
    top_oil_suppliers = [dict(r) for r in cursor.fetchall()]

    # 3. Top 5 Best Value (Lowest 42 Costing) Suppliers
    cursor.execute("""
        SELECT supplier_name, COUNT(*) as lot_count, ROUND(SUM(rec_wt_mt), 2) as total_mt,
               ROUND(AVG(oil_nir), 2) as avg_oil,
               ROUND(AVG(landing_cost_qtl), 2) as avg_landing_qtl,
               ROUND(AVG(cost_42_qtl), 2) as avg_cost_42_qtl
        FROM debit_note_records
        WHERE rec_wt_mt > 0 AND oil_nir > 0 AND cost_42_qtl > 0
        GROUP BY supplier_name
        ORDER BY avg_cost_42_qtl ASC
        LIMIT 5
    """)
    best_value_suppliers = [dict(r) for r in cursor.fetchall()]

    # 4. Critical Quality Alerts (Oil < 39%, Moisture > 6%, FM > 5%)
    cursor.execute("""
        SELECT gin, supplier_name, oil_analyzer, moisture_qc, fm_pct, rec_wt, actual_rate, cost_42
        FROM transactions
        WHERE (oil_analyzer < 39.0 AND oil_analyzer > 0)
           OR (moisture_qc > 6.0)
           OR (fm_pct > 5.0)
        ORDER BY id DESC
        LIMIT 6
    """)
    quality_alerts = [dict(r) for r in cursor.fetchall()]

    # 5. Dormant Suppliers (No recent bargain / deal)
    use_pg = is_postgres()
    if use_pg:
        having_clause = "HAVING MAX(TO_DATE(NULLIF(grn_date, ''), 'YYYY-MM-DD')) < (CURRENT_DATE - INTERVAL '21 days') OR MAX(grn_date) IS NULL"
    else:
        having_clause = "HAVING MAX(grn_date) < date('now', '-21 days') OR MAX(grn_date) IS NULL"

    cursor.execute(f"""
        SELECT supplier_name, MAX(grn_date) as last_seen, COUNT(*) as past_deals
        FROM transactions
        WHERE supplier_name IS NOT NULL
        GROUP BY supplier_name
        {having_clause}
        ORDER BY past_deals DESC
        LIMIT 5
    """)
    dormant_suppliers = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return {
        "kpis": kpis,
        "top_oil_suppliers": top_oil_suppliers,
        "best_value_suppliers": best_value_suppliers,
        "quality_alerts": quality_alerts,
        "dormant_suppliers": dormant_suppliers,
        "generated_at": datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")
    }

def generate_weekly_report_html(data: Dict[str, Any]) -> str:
    """Renders a modern, executive-level HTML email template."""
    kpis = data.get("kpis", {})
    top_oil = data.get("top_oil_suppliers", [])
    best_value = data.get("best_value_suppliers", [])
    alerts = data.get("quality_alerts", [])
    dormant = data.get("dormant_suppliers", [])
    generated_at = data.get("generated_at", "")

    # Top Oil Rows HTML
    top_oil_rows = "".join([
        f"""
        <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">{s.get('supplier_name')}</td>
            <td style="padding: 10px 12px; text-align: center; color: #047857; font-weight: bold; background: #ecfdf5;">{s.get('avg_oil')}%</td>
            <td style="padding: 10px 12px; text-align: right;">₹{s.get('avg_landing_qtl', 0):,.2f}</td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #2563eb;">₹{s.get('avg_cost_42_qtl', 0):,.2f}</td>
            <td style="padding: 10px 12px; text-align: center;">{s.get('total_mt', 0)} MT</td>
        </tr>
        """ for s in top_oil
    ])

    # Best Value Rows HTML
    best_value_rows = "".join([
        f"""
        <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">{s.get('supplier_name')}</td>
            <td style="padding: 10px 12px; text-align: right; color: #15803d; font-weight: bold; background: #f0fdf4;">₹{s.get('avg_cost_42_qtl', 0):,.2f}</td>
            <td style="padding: 10px 12px; text-align: center; color: #334155;">{s.get('avg_oil')}%</td>
            <td style="padding: 10px 12px; text-align: right;">₹{s.get('avg_landing_qtl', 0):,.2f}</td>
            <td style="padding: 10px 12px; text-align: center;">{s.get('total_mt', 0)} MT</td>
        </tr>
        """ for s in best_value
    ])

    # Quality Alerts HTML
    alert_rows = "".join([
        f"""
        <tr style="border-bottom: 1px solid #fee2e2;">
            <td style="padding: 8px 10px; font-family: monospace; font-weight: bold; color: #b91c1c;">{a.get('gin', 'N/A')}</td>
            <td style="padding: 8px 10px; color: #1e293b;">{a.get('supplier_name', 'N/A')}</td>
            <td style="padding: 8px 10px; text-align: center; color: {'#dc2626' if (a.get('oil_nir') or 0) < 39 else '#475569'}; font-weight: bold;">
                {a.get('oil_nir', a.get('oil_analyzer', 'N/A'))}%
            </td>
            <td style="padding: 8px 10px; text-align: center; color: {'#ea580c' if (a.get('moisture_qc') or 0) > 6 else '#475569'};">
                {a.get('moisture_qc', 'N/A')}%
            </td>
            <td style="padding: 8px 10px; text-align: center; color: {'#b45309' if (a.get('fm_pct') or 0) > 5 else '#475569'};">
                {a.get('fm_pct', 'N/A')}%
            </td>
        </tr>
        """ for a in alerts
    ])

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; }}
            .container {{ max-width: 700px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }}
            .header {{ background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%); color: #ffffff; padding: 28px 32px; }}
            .header h1 {{ margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }}
            .header p {{ margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1; }}
            .content {{ padding: 24px 32px; }}
            .kpi-grid {{ display: table; width: 100%; margin-bottom: 24px; }}
            .kpi-row {{ display: table-row; }}
            .kpi-box {{ display: table-cell; width: 33.33%; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; vertical-align: middle; }}
            .kpi-label {{ font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 4px; }}
            .kpi-value {{ font-size: 18px; font-weight: 800; color: #0f172a; }}
            .kpi-sub {{ font-size: 11px; color: #2563eb; margin-top: 2px; }}
            .section-title {{ font-size: 15px; font-weight: 700; color: #0f172a; margin: 24px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; display: flex; align-items: center; }}
            table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }}
            th {{ background: #f1f5f9; color: #475569; font-weight: 700; padding: 8px 12px; text-align: left; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }}
            .alert-banner {{ background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-bottom: 20px; }}
            .footer {{ background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 32px; text-align: center; font-size: 11px; color: #64748b; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Khandelia Oil & General Mills Pvt. Ltd.</h1>
                <p>Weekly Executive 42% Costing & Seed Quality AI Report • Generated on {generated_at}</p>
            </div>
            
            <div class="content">
                <!-- Executive KPI Matrix -->
                <div class="kpi-grid">
                    <div class="kpi-row">
                        <div class="kpi-box" style="margin-right: 8px;">
                            <div class="kpi-label">Total Inward</div>
                            <div class="kpi-value">{kpis.get('total_wt_mt', 0):,.1f} MT</div>
                            <div class="kpi-sub">{kpis.get('total_lots', 0)} Transactions</div>
                        </div>
                        <div class="kpi-box" style="margin: 0 4px;">
                            <div class="kpi-label">Avg Landing Cost</div>
                            <div class="kpi-value">₹{kpis.get('avg_landing_cost_qtl', 0):,.2f} <span style="font-size:11px;font-weight:normal;">/Qtl</span></div>
                            <div class="kpi-sub">₹{kpis.get('avg_landing_cost_mt', 0):,.2f} /MT</div>
                        </div>
                        <div class="kpi-box" style="margin-left: 8px;">
                            <div class="kpi-label">Avg 42 Costing</div>
                            <div class="kpi-value" style="color: #2563eb;">₹{kpis.get('avg_cost_42_qtl', 0):,.2f} <span style="font-size:11px;font-weight:normal;">/Qtl</span></div>
                            <div class="kpi-sub">Avg NIR Oil: <strong>{kpis.get('avg_oil_nir', 0)}%</strong></div>
                        </div>
                    </div>
                </div>

                <!-- Section 1: Top Oil Suppliers -->
                <div class="section-title">🥇 Top Suppliers by Highest Oil % (Quality Champions)</div>
                <table>
                    <thead>
                        <tr>
                            <th>Supplier Name</th>
                            <th style="text-align: center;">Avg Oil %</th>
                            <th style="text-align: right;">Landing Rate (₹/Qtl)</th>
                            <th style="text-align: right;">42 Cost (₹/Qtl)</th>
                            <th style="text-align: center;">Volume</th>
                        </tr>
                    </thead>
                    <tbody>
                        {top_oil_rows}
                    </tbody>
                </table>

                <!-- Section 2: Best Value (Lowest 42 Costing) -->
                <div class="section-title">💰 Top Best-Value Suppliers (Lowest 42 Costing)</div>
                <table>
                    <thead>
                        <tr>
                            <th>Supplier Name</th>
                            <th style="text-align: right;">42 Cost (₹/Qtl)</th>
                            <th style="text-align: center;">Avg Oil %</th>
                            <th style="text-align: right;">Landing Rate (₹/Qtl)</th>
                            <th style="text-align: center;">Volume</th>
                        </tr>
                    </thead>
                    <tbody>
                        {best_value_rows}
                    </tbody>
                </table>

                <!-- Section 3: Critical Quality Flags -->
                {f'''
                <div class="section-title" style="color: #b91c1c;">⚠️ Critical Quality Flags (Oil &lt; 39%, Moisture &gt; 6%, FM &gt; 5%)</div>
                <table>
                    <thead>
                        <tr style="background: #fee2e2;">
                            <th>GIN No</th>
                            <th>Supplier</th>
                            <th style="text-align: center;">NIR Oil %</th>
                            <th style="text-align: center;">Moisture %</th>
                            <th style="text-align: center;">FM %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {alert_rows}
                    </tbody>
                </table>
                ''' if alerts else ''}

                <!-- Section 4: Old Supplier Dormancy Alert -->
                {f'''
                <div class="section-title" style="color: #475569;">📞 No-Bargain Alert: Inactive Historical Suppliers</div>
                <p style="font-size: 11px; color: #64748b; margin-top: -6px; margin-bottom: 8px;">
                    Key past suppliers with no active purchase bargains in the last 21+ days:
                </p>
                <table>
                    <thead>
                        <tr>
                            <th>Supplier Name</th>
                            <th style="text-align: center;">Last Active Date</th>
                            <th style="text-align: center;">Past Total Deals</th>
                        </tr>
                    </thead>
                    <tbody>
                        {''.join([f"<tr><td style='padding:6px 12px; font-weight:600;'>{d.get('supplier_name')}</td><td style='padding:6px 12px; text-align:center; color:#64748b;'>{d.get('last_seen', 'Past Record')}</td><td style='padding:6px 12px; text-align:center;'>{d.get('past_deals')} deals</td></tr>" for d in dormant])}
                    </tbody>
                </table>
                ''' if dormant else ''}

            </div>

            <div class="footer">
                <p>This is an automated executive report generated by the <strong>Khandelia 42 Costing & Seed Quality AI Platform</strong>.</p>
                <p>Makers of <strong>Mashal Kachi Ghani Mustard Oil</strong> • Khandelia Oil & General Mills Pvt. Ltd., Chandigarh</p>
            </div>
        </div>
    </body>
    </html>
    """
    return html

def _send_via_google_webhook(target_email: str, subject: str, html_content: str) -> Dict[str, Any]:
    """Sends email via user's Google Apps Script Web App on HTTPS Port 443 (100% Free, Native Gmail)."""
    import requests
    print(f"[EMAIL] [Google Webhook] Calling webhook URL: {GMAIL_WEBHOOK_URL[:45]}...")
    payload = {
        "recipient": target_email,
        "subject": subject,
        "html": html_content
    }
    
    response = requests.post(
        GMAIL_WEBHOOK_URL,
        json=payload,
        headers={"Content-Type": "application/json", "User-Agent": "KOGMAnalytics/1.0"},
        timeout=30,
        allow_redirects=True
    )
    
    print(f"[EMAIL] [Google Webhook] Response Status: {response.status_code}")
    print(f"[EMAIL] [Google Webhook] Response Body: {response.text[:300]}")

    if response.status_code not in (200, 201, 302):
        raise RuntimeError(f"Google Webhook returned HTTP {response.status_code}: {response.text[:200]}")
        
    res_data = {}
    try:
        res_data = response.json()
    except Exception:
        pass

    if isinstance(res_data, dict) and res_data.get("success") is False:
        err_detail = res_data.get("error", "Google Webhook execution returned failure")
        raise RuntimeError(f"Google Webhook Error: {err_detail}")

    return {
        "success": True,
        "channel": "Google Apps Script Webhook (Port 443)",
        "message": f"Weekly 42% Costing report successfully sent to {target_email} via Gmail Webhook",
        "recipient": target_email,
        "timestamp": datetime.datetime.now().isoformat()
    }

def _send_via_resend(target_email: str, subject: str, html_content: str) -> Dict[str, Any]:
    """Sends email via Resend Cloud API on HTTPS Port 443."""
    print(f"[EMAIL] [Resend] Dispatching email via Resend API...")
    from_email = os.getenv("RESEND_FROM", f"KOGM Analytics <onboarding@resend.dev>")
    payload = json.dumps({
        "from": from_email,
        "to": [target_email],
        "subject": subject,
        "html": html_content
    }).encode("utf-8")
    
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json"
        }
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        res_body = response.read().decode("utf-8")
        print(f"[EMAIL] [Resend] Success Response: {res_body}")
        return {
            "success": True,
            "channel": "Resend API (Port 443)",
            "message": f"Weekly 42% Costing report successfully sent to {target_email} via Resend",
            "recipient": target_email,
            "timestamp": datetime.datetime.now().isoformat()
        }

def _send_via_brevo(target_email: str, subject: str, html_content: str) -> Dict[str, Any]:
    """Sends email via Brevo (Sendinblue) Cloud API on HTTPS Port 443."""
    print(f"[EMAIL] [Brevo] Dispatching email via Brevo API...")
    payload = json.dumps({
        "sender": {"name": "KOGM Analytics", "email": EMAIL_FROM},
        "to": [{"email": target_email}],
        "subject": subject,
        "htmlContent": html_content
    }).encode("utf-8")
    
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=payload,
        headers={
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json"
        }
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        res_body = response.read().decode("utf-8")
        print(f"[EMAIL] [Brevo] Success Response: {res_body}")
        return {
            "success": True,
            "channel": "Brevo API (Port 443)",
            "message": f"Weekly 42% Costing report successfully sent to {target_email} via Brevo",
            "recipient": target_email,
            "timestamp": datetime.datetime.now().isoformat()
        }

def _send_via_smtp(target_email: str, subject: str, html_content: str) -> Dict[str, Any]:
    """Sends email via direct Gmail SMTP (Works on local dev and unblocked cloud instances)."""
    print(f"[EMAIL] [SMTP] Connecting to {SMTP_HOST}:{SMTP_PORT} as {SMTP_USER}...")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"KOGM Analytics <{EMAIL_FROM}>"
    msg["To"] = target_email

    part = MIMEText(html_content, "html")
    msg.attach(part)

    server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)
    server.starttls()
    server.login(SMTP_USER, SMTP_PASSWORD)
    server.sendmail(EMAIL_FROM, [target_email], msg.as_string())
    server.quit()
    print(f"[EMAIL] [SMTP] Message sent successfully via Gmail SMTP!")

    return {
        "success": True,
        "channel": "Gmail SMTP (Port 587)",
        "message": f"Weekly 42% Costing report successfully sent to {target_email} via Gmail SMTP",
        "recipient": target_email,
        "timestamp": datetime.datetime.now().isoformat()
    }

def send_weekly_42_costing_email(recipient_email: Optional[str] = None) -> Dict[str, Any]:
    """
    Sends the weekly 42% costing HTML email report.
    Automatically routes through HTTPS Webhook / Cloud API on Render Free Tier
    where outbound SMTP port 587 is blocked.
    """
    target_email = recipient_email.strip() if recipient_email else DEFAULT_TEST_EMAIL
    subject = f"📊 Weekly 42% Costing & Quality Analytics Report — KOGM Mashal ({datetime.date.today().strftime('%d %b %Y')})"

    print("\n" + "=" * 65)
    print(f"[EMAIL DISPATCH] Initiating report send to: '{target_email}'")
    print(f"[EMAIL DISPATCH] Configuration:")
    print(f"  - GMAIL_WEBHOOK_URL : {'Configured (' + GMAIL_WEBHOOK_URL[:30] + '...)' if GMAIL_WEBHOOK_URL else 'Not Configured (Empty)'}")
    print(f"  - RESEND_API_KEY    : {'Configured' if RESEND_API_KEY else 'Not Configured (Empty)'}")
    print(f"  - BREVO_API_KEY     : {'Configured' if BREVO_API_KEY else 'Not Configured (Empty)'}")
    print(f"  - SMTP Target       : {SMTP_HOST}:{SMTP_PORT} ({SMTP_USER})")
    print("=" * 65)

    try:
        data = get_weekly_report_data()
        html_content = generate_weekly_report_html(data)
        
        # 1. Prefer Google Apps Script Webhook on HTTPS Port 443 if configured
        if GMAIL_WEBHOOK_URL and GMAIL_WEBHOOK_URL.startswith("http"):
            try:
                res = _send_via_google_webhook(target_email, subject, html_content)
                print(f"[EMAIL DISPATCH] Result: SUCCESS via Google Webhook! Recipient: {target_email}")
                return res
            except Exception as w_err:
                print(f"[EMAIL DISPATCH] Google Webhook failed: {w_err}. Falling back to next channel...")

        # 2. Try Resend Cloud API on HTTPS Port 443 if configured
        if RESEND_API_KEY:
            try:
                res = _send_via_resend(target_email, subject, html_content)
                print(f"[EMAIL DISPATCH] Result: SUCCESS via Resend! Recipient: {target_email}")
                return res
            except Exception as r_err:
                print(f"[EMAIL DISPATCH] Resend API failed: {r_err}. Falling back to next channel...")

        # 3. Try Brevo Cloud API on HTTPS Port 443 if configured
        if BREVO_API_KEY:
            try:
                res = _send_via_brevo(target_email, subject, html_content)
                print(f"[EMAIL DISPATCH] Result: SUCCESS via Brevo! Recipient: {target_email}")
                return res
            except Exception as b_err:
                print(f"[EMAIL DISPATCH] Brevo API failed: {b_err}. Falling back to next channel...")

        # 4. Standard SMTP attempt (Local dev or open cloud hosts)
        res = _send_via_smtp(target_email, subject, html_content)
        print(f"[EMAIL DISPATCH] Result: SUCCESS via Gmail SMTP! Recipient: {target_email}")
        return res

    except Exception as e:
        err_msg = str(e)
        print(f"[EMAIL DISPATCH] Error encountered: {err_msg}")
        if "101" in err_msg or "Network is unreachable" in err_msg or "timed out" in err_msg.lower():
            hint = (
                "Render Free Tier blocks raw SMTP port 587. "
                "To send emails from Render, please add GMAIL_WEBHOOK_URL (Google Apps Script Web App) "
                "or RESEND_API_KEY/BREVO_API_KEY to Render Environment Variables."
            )
            print(f"[EMAIL DISPATCH] DIAGNOSIS: {hint}")
            return {
                "success": False,
                "error": err_msg,
                "message": f"Render SMTP Block: {hint}",
                "recipient": target_email
            }
        
        return {
            "success": False,
            "error": err_msg,
            "message": f"Failed to send email to {target_email}: {err_msg}",
            "recipient": target_email
        }
