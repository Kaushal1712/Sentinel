"""Geolocation API — provides GeoJSON data for IP mapping."""

import ipaddress
import json
import logging

import httpx
from flask import Blueprint, jsonify

from auth.middleware import get_owned_scan, require_auth
from database import ScanResult

geo_bp = Blueprint("geo", __name__, url_prefix="/api/geo")
logger = logging.getLogger(__name__)

IP_API_URL = "http://ip-api.com/json/{ip}"


def _risk_for_ports(ports: list) -> str:
    """Assess risk based on open ports."""
    high_risk_ports = {21, 22, 23, 25, 445, 3389, 5900, 8080}
    if any(p in high_risk_ports for p in ports):
        return "high"
    if len(ports) > 5:
        return "medium"
    return "low"


@geo_bp.route("/<int:scan_id>/data", methods=["GET"])
@require_auth
def get_geo_data(scan_id):
    """Return GeoJSON FeatureCollection of geolocated IPs from a scan."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    features = []
    seen_ips = set()
    results = scan.results.all()

    for result in results:
        metadata = {}
        if result.metadata_json:
            try:
                metadata = json.loads(result.metadata_json)
            except (json.JSONDecodeError, TypeError):
                pass

        # Check enrichment data for Shodan results
        enrichment = metadata.get("enrichment", {})
        shodan_data = enrichment.get("shodan", {})

        if shodan_data and shodan_data.get("ip"):
            ip = shodan_data["ip"]
            if ip in seen_ips:
                continue
            seen_ips.add(ip)

            geo = enrichment.get("geo", {})
            if geo.get("lat") and geo.get("lon"):
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [geo["lon"], geo["lat"]],
                    },
                    "properties": {
                        "ip": ip,
                        "city": geo.get("city", "Unknown"),
                        "country": geo.get("country", "Unknown"),
                        "isp": shodan_data.get("isp", "Unknown"),
                        "organization": shodan_data.get("organization", ""),
                        "open_ports": shodan_data.get("open_ports", []),
                        "vulns": shodan_data.get("vulns", []),
                        "risk_level": _risk_for_ports(shodan_data.get("open_ports", [])),
                        "platform": result.platform,
                    },
                })

    # Fallback: use ip-api.com for any IPs we don't have enrichment for
    # (This is done client-side or via a separate call to avoid blocking)

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "total": len(features),
    })


@geo_bp.route("/<int:scan_id>/lookup/<ip>", methods=["GET"])
@require_auth
def lookup_ip(scan_id, ip):
    """Lookup geolocation for a single IP via ip-api.com.

    The <ip> path parameter is validated as a syntactically correct IPv4 or
    IPv6 address using the standard-library ipaddress module before it is
    interpolated into the external URL.  This prevents path-traversal and
    other injection attacks against the external service URL.
    """
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    # Validate the IP address before constructing the external URL.
    # ipaddress.ip_address() accepts only well-formed IPv4 and IPv6 addresses;
    # it raises ValueError for hostnames, paths, URLs, port-suffixed strings,
    # and any other non-address input.
    try:
        validated_ip = str(ipaddress.ip_address(ip))
    except ValueError:
        return jsonify({"error": "Invalid IP address"}), 400

    try:
        resp = httpx.get(IP_API_URL.format(ip=validated_ip), timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "success":
                return jsonify({
                    "ip": validated_ip,
                    "lat": data.get("lat"),
                    "lon": data.get("lon"),
                    "city": data.get("city"),
                    "region": data.get("regionName"),
                    "country": data.get("country"),
                    "isp": data.get("isp"),
                    "org": data.get("org"),
                    "timezone": data.get("timezone"),
                })
    except Exception:  # noqa: BLE001
        pass

    return jsonify({"error": "Could not geolocate IP"}), 404
