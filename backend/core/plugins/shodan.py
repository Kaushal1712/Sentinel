"""Shodan OSINT plugin — queries IP/infrastructure exposure data."""

import os
import logging

import httpx

logger = logging.getLogger(__name__)

SHODAN_API_BASE = "https://api.shodan.io"


def _get_api_key() -> str | None:
    """Retrieve the Shodan API key from environment."""
    try:
        from flask import current_app
        key = current_app.config.get("SHODAN_API_KEY")
        if key:
            return key
    except Exception:
        pass
    return os.environ.get("SHODAN_API_KEY") or None


async def analyze_ip(ip: str, client: httpx.AsyncClient) -> dict:
    """Query Shodan for a single IP address and return enrichment data."""
    api_key = _get_api_key()
    if not api_key:
        logger.debug("Shodan plugin skipped: no API key configured")
        return {}

    rich_data = {
        "ip": ip,
        "open_ports": [],
        "services": [],
        "vulns": [],
        "organization": None,
        "isp": None,
        "country": None,
        "city": None,
        "os": None,
        "last_update": None,
    }

    try:
        resp = await client.get(
            f"{SHODAN_API_BASE}/shodan/host/{ip}",
            params={"key": api_key},
            timeout=15.0,
        )

        if resp.status_code == 404:
            return {"ip": ip, "status": "not_found"}
        if resp.status_code == 401:
            logger.warning("Shodan API: unauthorized — check your API key")
            return {}
        if resp.status_code != 200:
            logger.debug(f"Shodan API returned {resp.status_code} for {ip}")
            return {}

        data = resp.json()

        rich_data["open_ports"] = data.get("ports", [])
        rich_data["organization"] = data.get("org")
        rich_data["isp"] = data.get("isp")
        rich_data["country"] = data.get("country_name")
        rich_data["city"] = data.get("city")
        rich_data["os"] = data.get("os")
        rich_data["last_update"] = data.get("last_update")
        rich_data["vulns"] = data.get("vulns", [])

        # Extract services from data entries
        for entry in data.get("data", [])[:10]:
            service_info = {
                "port": entry.get("port"),
                "transport": entry.get("transport"),
                "product": entry.get("product"),
                "version": entry.get("version"),
                "banner_preview": (entry.get("data") or "")[:200],
            }
            rich_data["services"].append(service_info)

    except Exception as e:
        logger.warning(f"Shodan plugin error for {ip}: {e}")

    return {k: v for k, v in rich_data.items() if v is not None and v != "" and v != []}
