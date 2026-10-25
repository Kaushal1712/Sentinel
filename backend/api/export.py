import csv
import html
import io
import json
from datetime import datetime, timezone

from flask import Blueprint, Response, jsonify

from auth.middleware import get_owned_scan, require_auth
from core.evidence import list_evidence
from database import db

export_bp = Blueprint("export", __name__, url_prefix="/api/export")


def _pdf_safe(value):
    text = "" if value is None else str(value)
    replacements = {
        "—": "-",
        "–": "-",
        "->": "->",
        "←": "<-",
        "→": "->",
        "•": "*",
        "…": "...",
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "\u00a0": " ",
    }

    for source, target in replacements.items():
        text = text.replace(source, target)

    return text.encode("latin-1", "replace").decode("latin-1")


@export_bp.route("/<int:scan_id>/json", methods=["GET"])
@require_auth
def export_json(scan_id):
    """Export full scan data as JSON."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    results = [result.to_dict() for result in scan.results.all()]
    nodes = [node.to_dict() for node in scan.nodes.all()]
    edges = [edge.to_dict() for edge in scan.edges.all()]

    export_data = {
        "scan": scan.to_dict(),
        "results": results,
        "graph": {"nodes": nodes, "edges": edges},
        "meta": {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "total_results": len(results),
            "total_nodes": len(nodes),
            "total_edges": len(edges),
        },
    }

    return Response(
        json.dumps(export_data, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename=dfas_scan_{scan_id}.json"},
    )


@export_bp.route("/<int:scan_id>/csv", methods=["GET"])
@require_auth
def export_csv(scan_id):
    """Export scan results as CSV."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    results = scan.results.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Platform",
            "URL",
            "Username",
            "Confidence",
            "Risk Level",
            "Category",
            "Emails Found",
            "Phones Found",
            "Discovered At",
        ]
    )

    for result in results:
        emails = json.loads(result.emails_found) if result.emails_found else []
        phones = json.loads(result.phones_found) if result.phones_found else []
        writer.writerow(
            [
                result.platform,
                result.url,
                result.username or "",
                f"{result.confidence:.1%}",
                result.risk_level,
                result.category,
                "; ".join(emails),
                "; ".join(phones),
                result.discovered_at.isoformat() if result.discovered_at else "",
            ]
        )

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=dfas_scan_{scan_id}.csv"},
    )


@export_bp.route("/<int:scan_id>/delete", methods=["DELETE"])
@require_auth
def delete_scan(scan_id):
    """Delete a scan and all associated data."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    db.session.delete(scan)
    db.session.commit()
    return jsonify({"message": "Scan deleted successfully"}), 200


@export_bp.route("/<int:scan_id>/pdf", methods=["GET"])
@require_auth
def export_pdf(scan_id):
    """Generate and download a structured PDF intelligence report."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    try:
        from fpdf import FPDF
    except ImportError:
        return jsonify({"error": "fpdf2 not installed - run pip install fpdf2"}), 500

    results = scan.results.all()
    evidence = list_evidence(scan_id)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    risk_colours = {
        "critical": (220, 38, 38),
        "high": (234, 88, 12),
        "medium": (202, 138, 4),
        "low": (22, 163, 74),
    }
    score_colours = {
        "green": (22, 163, 74),
        "yellow": (202, 138, 4),
        "red": (220, 38, 38),
    }

    def score_colour(score):
        if score is None:
            return score_colours["red"]
        if score >= 0.70:
            return score_colours["green"]
        if score >= 0.40:
            return score_colours["yellow"]
        return score_colours["red"]

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(15, 15, 15)

    pdf.add_page()
    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, 0, 210, 28, "F")
    pdf.set_text_color(99, 102, 241)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_xy(15, 8)
    pdf.cell(0, 10, _pdf_safe("Sentinel Intelligence Report"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(148, 163, 184)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_xy(15, 20)
    pdf.cell(
        0,
        5,
        _pdf_safe(f"Generated: {generated_at}  |  Scan #{scan_id}  |  Mode: {scan.mode.upper()}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )

    pdf.set_text_color(0, 0, 0)
    pdf.ln(10)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 8, _pdf_safe("Target Identity"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)

    fields = [
        ("Name", scan.target_name or "-"),
        ("Email", scan.target_email or "-"),
        ("Username", scan.target_username or "-"),
        ("Phone", scan.target_phone or "-"),
        ("Status", scan.status.upper()),
        ("Completed", scan.completed_at.strftime("%Y-%m-%d %H:%M UTC") if scan.completed_at else "-"),
    ]
    for label, value in fields:
        pdf.set_fill_color(241, 245, 249)
        pdf.cell(45, 7, _pdf_safe(label), border=1, fill=True)
        pdf.cell(135, 7, _pdf_safe(str(value)[:80]), border=1, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 8, _pdf_safe("Risk Summary"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)

    risk_score = scan.risk_score or 0.0
    if risk_score >= 8.0:
        risk_label, summary_colour = "CRITICAL", risk_colours["critical"]
    elif risk_score >= 6.0:
        risk_label, summary_colour = "HIGH", risk_colours["high"]
    elif risk_score >= 3.0:
        risk_label, summary_colour = "MEDIUM", risk_colours["medium"]
    else:
        risk_label, summary_colour = "LOW", risk_colours["low"]

    summary_fields = [
        ("Overall Risk Score", f"{risk_score:.1f} / 10.0 ({risk_label})"),
        ("Platforms Found", str(scan.platforms_found or 0)),
        ("Entities Found", str(scan.entities_found or 0)),
        ("Evidence Files", str(len(evidence))),
        ("Total Results", str(len(results))),
    ]
    for label, value in summary_fields:
        pdf.set_fill_color(241, 245, 249)
        pdf.cell(60, 7, _pdf_safe(label), border=1, fill=True)
        if label == "Overall Risk Score":
            pdf.set_text_color(*summary_colour)
            pdf.set_font("Helvetica", "B", 9)
        pdf.cell(120, 7, _pdf_safe(value), border=1, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 9)

    pdf.add_page()
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 8, _pdf_safe("Discovered Profiles and Intelligence"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    col_w = [38, 55, 22, 20, 22, 23]
    headers = ["Platform", "URL", "Match%", "Risk", "Activity", "Category"]
    pdf.set_fill_color(15, 23, 42)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 8)
    for index, header in enumerate(headers):
        pdf.cell(col_w[index], 7, _pdf_safe(header), border=1, fill=True)
    pdf.ln()
    pdf.set_text_color(0, 0, 0)

    pdf.set_font("Helvetica", "", 7)
    for row_index, result in enumerate(results):
        emails = json.loads(result.emails_found) if result.emails_found else []
        phones = json.loads(result.phones_found) if result.phones_found else []
        match_score = result.match_score
        score_pct = f"{match_score:.0%}" if match_score is not None else "N/A"
        risk = (result.risk_level or "low").upper()
        risk_colour = risk_colours.get(result.risk_level or "low", (0, 0, 0))
        match_colour = score_colour(match_score)

        match_reasons = []
        if result.match_reasons:
            try:
                match_reasons = json.loads(result.match_reasons)
            except Exception:
                match_reasons = []

        activity = "-"
        if result.last_seen_at:
            age_days = (datetime.now(timezone.utc) - result.last_seen_at.replace(tzinfo=timezone.utc)).days
            if age_days <= 1:
                activity = "Active"
            elif age_days <= 30:
                activity = "Recent"
            else:
                activity = "Historic"

        platform_short = (result.platform or "")[:16]
        url_short = (result.url or "")[:35] + ("..." if len(result.url or "") > 35 else "")
        category_short = (result.category or "")[:10]

        row_fill = (249, 250, 251) if row_index % 2 == 0 else (255, 255, 255)
        pdf.set_fill_color(*row_fill)
        pdf.cell(col_w[0], 6, _pdf_safe(platform_short), border=1, fill=True)
        pdf.cell(col_w[1], 6, _pdf_safe(url_short), border=1, fill=True)
        pdf.set_text_color(*match_colour)
        pdf.set_font("Helvetica", "B", 7)
        pdf.cell(col_w[2], 6, _pdf_safe(score_pct), border=1, fill=True)
        pdf.set_text_color(*risk_colour)
        pdf.cell(col_w[3], 6, _pdf_safe(risk), border=1, fill=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 7)
        pdf.cell(col_w[4], 6, _pdf_safe(activity), border=1, fill=True)
        pdf.cell(col_w[5], 6, _pdf_safe(category_short), border=1, new_x="LMARGIN", new_y="NEXT", fill=True)

        if match_reasons:
            reason_text = " | ".join(match_reasons)[:100]
            pdf.set_text_color(100, 116, 139)
            pdf.set_font("Helvetica", "I", 6)
            pdf.cell(10, 5, "", border=0)
            pdf.cell(170, 5, _pdf_safe(f"  -> {reason_text}"), border=0, new_x="LMARGIN", new_y="NEXT")
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Helvetica", "", 7)

        if emails or phones:
            pii = []
            if emails:
                pii.append("Email: " + ", ".join(emails[:2]))
            if phones:
                pii.append("Phone: " + ", ".join(phones[:2]))
            pdf.set_text_color(220, 38, 38)
            pdf.set_font("Helvetica", "B", 6)
            pdf.cell(10, 5, "", border=0)
            pdf.cell(
                170,
                5,
                _pdf_safe("  ! " + " | ".join(pii)[:100]),
                border=0,
                new_x="LMARGIN",
                new_y="NEXT",
            )
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Helvetica", "", 7)

    if evidence:
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 8, _pdf_safe("Evidence Archive"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(
            0,
            6,
            _pdf_safe("The following timestamped snapshots were captured during the scan:"),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.ln(3)
        for record in evidence:
            pdf.set_font("Helvetica", "B", 8)
            pdf.cell(0, 6, _pdf_safe(record["filename"]), new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(100, 116, 139)
            pdf.cell(
                0,
                5,
                _pdf_safe(f"  Captured: {record['created_at']}  |  Size: {record['size_bytes']} bytes"),
                new_x="LMARGIN",
                new_y="NEXT",
            )
            pdf.set_text_color(0, 0, 0)

    pdf.set_y(-15)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(148, 163, 184)
    pdf.cell(
        0,
        5,
        _pdf_safe(f"Sentinel Confidential Intelligence Report - Scan #{scan_id} - {generated_at}"),
        align="C",
    )

    pdf_output = pdf.output()
    pdf_bytes = pdf_output.encode("latin-1", "replace") if isinstance(pdf_output, str) else bytes(pdf_output)

    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=dfas_report_{scan_id}.pdf"},
    )


@export_bp.route("/<int:scan_id>/stix", methods=["GET"])
@require_auth
def export_stix(scan_id):
    """Export scan findings as a STIX 2.1 Bundle."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    import uuid

    results = [r.to_dict() for r in scan.results.all()]
    nodes = [n.to_dict() for n in scan.nodes.all()]
    edges = [e.to_dict() for e in scan.edges.all()]

    now = datetime.now(timezone.utc).isoformat() + "Z"

    stix_objects = []

    # Identity for the target
    target_id = f"identity--{uuid.uuid5(uuid.NAMESPACE_URL, scan.target_name or 'unknown')}"
    stix_objects.append({
        "type": "identity",
        "spec_version": "2.1",
        "id": target_id,
        "created": now,
        "modified": now,
        "name": scan.target_name or "Unknown",
        "identity_class": "individual",
        "description": f"OSINT target scanned by Sentinel. Email: {scan.target_email or 'N/A'}, Username: {scan.target_username or 'N/A'}",
    })

    # Each discovered profile → Infrastructure
    for result in results:
        infra_id = f"infrastructure--{uuid.uuid5(uuid.NAMESPACE_URL, result.get('url', ''))}"
        stix_objects.append({
            "type": "infrastructure",
            "spec_version": "2.1",
            "id": infra_id,
            "created": now,
            "modified": now,
            "name": f"{result.get('platform', 'Unknown')} Profile",
            "description": f"URL: {result.get('url', '')}. Confidence: {result.get('confidence', 0):.0%}",
            "infrastructure_types": ["hosting-target-lists"],
        })

        # Relationship: target → infrastructure
        rel_id = f"relationship--{uuid.uuid5(uuid.NAMESPACE_URL, f'{target_id}-{infra_id}')}"
        stix_objects.append({
            "type": "relationship",
            "spec_version": "2.1",
            "id": rel_id,
            "created": now,
            "modified": now,
            "relationship_type": "uses",
            "source_ref": target_id,
            "target_ref": infra_id,
        })

        # Emails/phones → Indicator
        for email in result.get("emails_found", []):
            indicator_id = f"indicator--{uuid.uuid5(uuid.NAMESPACE_URL, email)}"
            stix_objects.append({
                "type": "indicator",
                "spec_version": "2.1",
                "id": indicator_id,
                "created": now,
                "modified": now,
                "name": f"Email: {email}",
                "pattern": f"[email-addr:value = '{email}']",
                "pattern_type": "stix",
                "valid_from": now,
                "indicator_types": ["attribution"],
            })

    # Wrap in Bundle
    bundle = {
        "type": "bundle",
        "id": f"bundle--{uuid.uuid4()}",
        "objects": stix_objects,
    }

    return Response(
        json.dumps(bundle, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename=dfas_stix_{scan_id}.json"},
    )


@export_bp.route("/<int:scan_id>/html", methods=["GET"])
@require_auth
def export_html(scan_id):
    """Generate a self-contained, styled HTML intelligence report."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    results = scan.results.all()
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    risk_score = scan.risk_score or 0
    risk_label = "CRITICAL" if risk_score >= 8 else "HIGH" if risk_score >= 6 else "MEDIUM" if risk_score >= 3 else "LOW"
    risk_color = "#dc2626" if risk_score >= 8 else "#ea580c" if risk_score >= 6 else "#ca8a04" if risk_score >= 3 else "#16a34a"

    rows_html = ""
    for r in results:
        emails = json.loads(r.emails_found) if r.emails_found else []
        phones = json.loads(r.phones_found) if r.phones_found else []
        risk_cls = r.risk_level or "low"
        risk_cell_color = {"critical": "#dc2626", "high": "#ea580c", "medium": "#ca8a04", "low": "#16a34a"}.get(risk_cls, "#94a3b8")
        # Escape every external/user-derived field before HTML interpolation (F-03 fix).
        safe_platform = html.escape(r.platform or "")
        raw_url = r.url or ""
        safe_url_attr = html.escape(raw_url)          # used in href attribute
        safe_url_text = html.escape(raw_url[:50])     # used as visible link text
        safe_category = html.escape(r.category or "other")
        safe_emails = ", ".join(html.escape(e) for e in emails[:2])
        safe_phones = ", ".join(html.escape(p) for p in phones[:2])
        pii = ""
        if emails:
            pii += f"<br><small style='color:#ef4444'>&#x1F4E7; {safe_emails}</small>"
        if phones:
            pii += f"<br><small style='color:#ef4444'>&#x1F4F1; {safe_phones}</small>"
        rows_html += f"""<tr>
            <td>{safe_platform}</td>
            <td><a href="{safe_url_attr}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa">{safe_url_text}</a></td>
            <td>{r.confidence:.0%}</td>
            <td style="color:{risk_cell_color};font-weight:600">{risk_cls.upper()}</td>
            <td>{safe_category}{pii}</td>
        </tr>"""

    report_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sentinel Report — Scan #{scan_id}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6;padding:40px}}
.container{{max-width:900px;margin:0 auto}}
header{{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:12px;padding:30px;margin-bottom:24px}}
header h1{{font-size:1.5rem;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}}
header p{{color:#94a3b8;font-size:0.85rem}}
.risk-banner{{display:flex;align-items:center;gap:20px;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:24px}}
.risk-score{{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:800;border:3px solid {risk_color};color:{risk_color}}}
.risk-label{{display:inline-block;padding:4px 12px;border-radius:6px;font-size:0.75rem;font-weight:600;color:white;background:{risk_color}}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin-bottom:24px}}
.stat{{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center}}
.stat-value{{font-size:1.4rem;font-weight:700;color:#f1f5f9}}
.stat-label{{font-size:0.75rem;color:#94a3b8;margin-top:4px}}
.section{{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;margin-bottom:24px}}
.section h2{{font-size:1.1rem;color:#f1f5f9;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #334155}}
table{{width:100%;border-collapse:collapse}}
th{{text-align:left;padding:10px 12px;background:#0f172a;color:#94a3b8;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em}}
td{{padding:10px 12px;border-top:1px solid #1e293b;font-size:0.85rem}}
tr:hover{{background:#1e293b80}}
a{{text-decoration:none}}
footer{{text-align:center;padding:20px;color:#475569;font-size:0.75rem}}
@media print{{body{{background:white;color:black}} .section,.risk-banner,.stat,.container header{{background:white;border-color:#e2e8f0}} th{{background:#f1f5f9;color:#1e293b}}}}
</style>
</head>
<body>
<div class="container">
<header>
<h1>Sentinel Intelligence Report</h1>
<p>Scan #{scan_id} &#x2022; {html.escape(scan.mode.upper())} Mode &#x2022; Generated: {generated_at}</p>
</header>

<div class="risk-banner">
<div class="risk-score">{risk_score:.1f}</div>
<div>
<h3 style="margin-bottom:6px">{html.escape(scan.target_name or 'Target')}</h3>
<span class="risk-label">{risk_label} RISK</span>
<p style="color:#94a3b8;font-size:0.8rem;margin-top:6px">Email: {html.escape(scan.target_email or 'N/A')} | Username: {html.escape(scan.target_username or 'N/A')}</p>
</div>
</div>

<div class="stats">
<div class="stat"><div class="stat-value">{scan.platforms_found or 0}</div><div class="stat-label">Platforms</div></div>
<div class="stat"><div class="stat-value">{scan.entities_found or 0}</div><div class="stat-label">Entities</div></div>
<div class="stat"><div class="stat-value">{len(results)}</div><div class="stat-label">Results</div></div>
<div class="stat"><div class="stat-value">{risk_score:.1f}</div><div class="stat-label">Risk Score</div></div>
</div>

<div class="section">
<h2>Discovered Profiles & Intelligence</h2>
<table>
<thead><tr><th>Platform</th><th>URL</th><th>Match</th><th>Risk</th><th>Category</th></tr></thead>
<tbody>{rows_html}</tbody>
</table>
</div>

<footer>
<p>Sentinel Confidential Intelligence Report — Scan #{scan_id} — {generated_at}</p>
<p>For authorized security research purposes only.</p>
</footer>
</div>
</body>
</html>"""

    return Response(
        report_html,
        mimetype="text/html",
        headers={"Content-Disposition": f"attachment; filename=dfas_report_{scan_id}.html"},
    )
