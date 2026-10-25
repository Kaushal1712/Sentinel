"""Wayback Machine OSINT plugin — checks Archive.org for historical profile snapshots."""

import asyncio
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

CDX_API = "http://web.archive.org/cdx/search/cdx"


async def analyze_url(url: str, client: httpx.AsyncClient) -> dict:
    """Query the Wayback Machine CDX API for historical snapshot data of a URL."""
    rich_data = {
        "url": url,
        "first_seen": None,
        "last_seen": None,
        "total_snapshots": 0,
        "oldest_snapshot_url": None,
        "newest_snapshot_url": None,
    }

    try:
        # Rate limit: be polite to Archive.org
        await asyncio.sleep(0.5)

        params = {
            "url": url,
            "output": "json",
            "fl": "timestamp,statuscode",
            "limit": 500,
            "filter": "statuscode:200",
            "collapse": "timestamp:6",  # Collapse by month
        }

        resp = await client.get(
            CDX_API,
            params=params,
            timeout=20.0,
            follow_redirects=True,
        )

        if resp.status_code != 200:
            return {}

        data = resp.json()

        # First row is the header
        if len(data) <= 1:
            return {}

        rows = data[1:]  # Skip header
        rich_data["total_snapshots"] = len(rows)

        if rows:
            # Parse first seen
            first_ts = rows[0][0]
            last_ts = rows[-1][0]

            try:
                rich_data["first_seen"] = datetime.strptime(
                    first_ts, "%Y%m%d%H%M%S"
                ).replace(tzinfo=timezone.utc).isoformat()
            except (ValueError, IndexError):
                rich_data["first_seen"] = first_ts

            try:
                rich_data["last_seen"] = datetime.strptime(
                    last_ts, "%Y%m%d%H%M%S"
                ).replace(tzinfo=timezone.utc).isoformat()
            except (ValueError, IndexError):
                rich_data["last_seen"] = last_ts

            rich_data["oldest_snapshot_url"] = (
                f"https://web.archive.org/web/{first_ts}/{url}"
            )
            rich_data["newest_snapshot_url"] = (
                f"https://web.archive.org/web/{last_ts}/{url}"
            )

    except Exception as e:
        logger.debug(f"Wayback plugin error for {url}: {e}")

    return {k: v for k, v in rich_data.items() if v is not None and v != "" and v != 0}
