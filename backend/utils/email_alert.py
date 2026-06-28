"""
CityShield AI — Email Alert Dispatcher
Sends a dispatch alert email (with snapshot attached) via Gmail SMTP.
Credentials are read from environment variables — never hardcoded.
"""
import smtplib
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from email.mime.image     import MIMEImage
from datetime             import datetime


def send_dispatch_alert(incident: dict) -> bool:
    """
    Send a police dispatch alert email for the given incident.
    Returns True on success, False on failure (never raises).
    """
    gmail_user = os.getenv("GMAIL_USER", "").strip()
    gmail_pass = os.getenv("GMAIL_APP_PASSWORD", "").strip()
    alert_to   = os.getenv("ALERT_EMAIL", gmail_user).strip()

    if not gmail_user or not gmail_pass:
        print("[Email] GMAIL_USER / GMAIL_APP_PASSWORD not configured — skipping alert")
        return False

    try:
        inc_id     = incident.get("id", "?")
        camera     = incident.get("camera_id", "CAM-01")
        desc       = incident.get("description", "Violence Detected")
        timestamp  = incident.get("timestamp",  datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        confidence = round((incident.get("confidence", 0) or 0) * 100, 1)
        snap_path  = incident.get("snapshot_path", "")   # e.g. /snapshots/CAM-01_xyz.jpg
        reviewed_by = incident.get("reviewed_by", "Operator")

        subject = f"🚨 POLICE DISPATCH — Violence Detected [{camera}] | INC-{str(inc_id).zfill(4)}"

        html_body = f"""
<html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
  <div style="max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

    <div style="background:#dc2626;padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">🚨 POLICE DISPATCH ALERT</h1>
      <p style="color:#fecaca;margin:4px 0 0;font-size:13px;">CityShield AI — Real-Time Violence Detection System</p>
    </div>

    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Incident Ref</td>
            <td style="padding:8px 0;font-weight:600;">INC-{str(inc_id).zfill(4)}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;">Camera</td>
            <td style="padding:8px;font-weight:600;">{camera}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">Event</td>
            <td style="padding:8px 0;">{desc}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;">Detected At</td>
            <td style="padding:8px;">{timestamp}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;">AI Confidence</td>
            <td style="padding:8px 0;font-weight:600;color:#dc2626;">{confidence}%</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;">Dispatched By</td>
            <td style="padding:8px;">{reviewed_by}</td></tr>
      </table>

      {"<p style='margin-top:16px;font-size:13px;color:#6b7280;'>Evidence snapshot attached below.</p>" if snap_path else ""}

      <div style="margin-top:20px;padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;">
        <p style="margin:0;font-size:13px;color:#dc2626;">
          <strong>ACTION REQUIRED:</strong> A police unit has been dispatched to the incident location.
          Please review the attached evidence and take appropriate action.
        </p>
      </div>
    </div>

    <div style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
      This alert was generated automatically by CityShield AI at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}.
      Do not reply to this email.
    </div>
  </div>
</body></html>
"""

        msg = MIMEMultipart("related")
        msg["Subject"] = subject
        msg["From"]    = f"CityShield AI <{gmail_user}>"
        msg["To"]      = alert_to

        msg.attach(MIMEText(html_body, "html"))

        # Attach snapshot if it exists on disk
        if snap_path:
            disk_path = snap_path.lstrip("/").replace("/", os.sep)  # /snapshots/x.jpg → snapshots\x.jpg
            if os.path.exists(disk_path):
                with open(disk_path, "rb") as f:
                    img = MIMEImage(f.read(), name=os.path.basename(disk_path))
                    img.add_header("Content-Disposition", "attachment",
                                   filename=os.path.basename(disk_path))
                    msg.attach(img)

        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.ehlo()
            server.starttls()
            server.login(gmail_user, gmail_pass)
            server.sendmail(gmail_user, alert_to, msg.as_string())

        print(f"[Email] Dispatch alert sent → {alert_to} (INC-{str(inc_id).zfill(4)})")
        return True

    except Exception as e:
        print(f"[Email] Failed to send alert: {e}")
        return False
