"""Dark web monitoring plugin — IntelligenceX primary, LeakIX fallback."""

import os
import asyncio
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)


def _get_key(name: str) -> str | None:
    try:
        from flask import current_app
        key = current_app.config.get(name)
        if key:
            return key
    except Exception:
        pass
    return os.environ.get(name) or None


async def _search_intelx(query: str, api_key: str, client: httpx.AsyncClient) -> list:
    """Search IntelligenceX for mentions of a target."""
    results = []
    try:
        # Initiate search
        resp = await client.post(
            "https://2.intelx.io/intelligent/search",
            json={
                "term": query,
                "maxresults": 20,
                "media": 0,  # All types
                "sort": 2,   # Date descending
                "terminate": [],
            },
            headers={"x-key": api_key},
            timeout=15.0,
        )

        if resp.status_code != 200:
            return []

        search_id = resp.json().get("id")
        if not search_id:
            return []

        # Wait briefly then fetch results
        await asyncio.sleep(2)

        result_resp = await client.get(
            f"https://2.intelx.io/intelligent/search/result",
            params={"id": search_id, "limit": 20},
            headers={"x-key": api_key},
            timeout=15.0,
        )

        if result_resp.status_code == 200:
            data = result_resp.json()
            for record in data.get("records", []):
                results.append({
                    "name": record.get("name", ""),
                    "source_type": record.get("type", "unknown"),
                    "date": record.get("date", ""),
                    "bucket": record.get("bucket", ""),
                    "media": record.get("mediah", ""),
                    "system_id": record.get("systemid", ""),
                    "source": "intelx",
                })

    except Exception as e:
        logger.debug(f"IntelligenceX search error for {query}: {e}")

    return results


async def _search_leakix(query: str, client: httpx.AsyncClient) -> list:
    """Search LeakIX public API as a fallback."""
    results = []
    try:
        resp = await client.get(
            "https://leakix.net/search",
            params={"q": query, "page": 0, "scope": "leak"},
            headers={
                "Accept": "application/json",
                "User-Agent": "DFAS-OSINT/2.0",
            },
            timeout=15.0,
        )

        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                for record in data[:15]:
                    results.append({
                        "name": record.get("summary", ""),
                        "source_type": "leak",
                        "date": record.get("time", ""),
                        "host": record.get("host", ""),
                        "port": record.get("port"),
                        "protocol": record.get("protocol", ""),
                        "country": record.get("geoip", {}).get("country_name", ""),
                        "source": "leakix",
                    })

    except Exception as e:
        logger.debug(f"LeakIX search error for {query}: {e}")

    return results


async def analyze(username: str, email: str | None = None,
                  client: httpx.AsyncClient | None = None) -> dict:
    """Check dark web and leak databases for target mentions."""
    rich_data = {
        "dark_web_mentions": [],
        "total_hits": 0,
        "severity": "none",
        "sources_checked": [],
    }

    if client is None:
        from core.http_client import create_async_client
        async with create_async_client() as c:
            return await _run_search(username, email, c, rich_data)
    else:
        return await _run_search(username, email, client, rich_data)


async def _run_search(username: str, email: str | None,
                      client: httpx.AsyncClient, rich_data: dict) -> dict:
    """Execute the dark web search across available sources."""
    queries = [username]
    if email:
        queries.append(email)

    intelx_key = _get_key("INTELX_API_KEY")

    all_results = []

    if intelx_key:
        rich_data["sources_checked"].append("intelx")
        for query in queries:
            results = await _search_intelx(query, intelx_key, client)
            all_results.extend(results)
    else:
        # Fallback to LeakIX (no key needed)
        rich_data["sources_checked"].append("leakix")
        for query in queries:
            results = await _search_leakix(query, client)
            all_results.extend(results)

    # Deduplicate by name
    seen = set()
    unique = []
    for r in all_results:
        key = f"{r.get('name', '')}:{r.get('date', '')}"
        if key not in seen:
            seen.add(key)
            unique.append(r)

    rich_data["dark_web_mentions"] = unique[:20]
    rich_data["total_hits"] = len(unique)

    # Assess severity
    if len(unique) >= 10:
        rich_data["severity"] = "critical"
    elif len(unique) >= 5:
        rich_data["severity"] = "high"
    elif len(unique) >= 1:
        rich_data["severity"] = "medium"

    return rich_data if rich_data["dark_web_mentions"] else {}
