"""Pastebin / paste site leak detection plugin."""

import re
import logging

import httpx
from core.http_client import build_request_headers, create_async_client

logger = logging.getLogger(__name__)

LEAK_KEYWORDS = [
    "password", "passwd", "pwd", "leak", "dump", "breach", "credential",
    "hash", "crack", "combo", "database", "stolen", "exploit", "vuln",
    "leaked", "compromised", "exposed",
]

PASTE_DORK_TEMPLATES = [
    'site:pastebin.com "{target}"',
    'site:rentry.co "{target}"',
    'site:paste.ee "{target}"',
    'site:dpaste.org "{target}"',
    '"{target}" password OR leak OR dump OR breach',
]


def _check_snippet_for_leaks(snippet: str) -> list[str]:
    """Check if a snippet contains leak-related keywords."""
    snippet_lower = (snippet or "").lower()
    return [kw for kw in LEAK_KEYWORDS if kw in snippet_lower]


async def analyze(username: str, email: str | None = None,
                  searxng_url: str | None = None,
                  searxng_enabled: bool = False,
                  client: httpx.AsyncClient | None = None) -> dict:
    """Search paste sites for leaked credentials mentioning the target."""
    rich_data = {
        "paste_leaks": [],
        "total_hits": 0,
        "leak_detected": False,
        "risk_level": "none",
    }

    targets = [username]
    if email:
        targets.append(email)

    all_results = []

    for target in targets:
        dorks = [t.format(target=target) for t in PASTE_DORK_TEMPLATES]

        if searxng_enabled and searxng_url:
            # Use SearxNG for privacy-respecting search
            async with create_async_client() as search_client:
                for query in dorks[:3]:
                    try:
                        resp = await search_client.get(
                            searxng_url,
                            params={
                                "q": query,
                                "format": "json",
                                "engines": "google,bing,duckduckgo",
                            },
                            headers=build_request_headers(no_cache=False),
                            timeout=10.0,
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            for item in data.get("results", [])[:5]:
                                all_results.append({
                                    "title": item.get("title", ""),
                                    "url": item.get("url", ""),
                                    "snippet": item.get("content", ""),
                                    "source": "searxng",
                                })
                    except Exception:
                        continue
        else:
            # Direct check: try to load pastebin search page
            if client:
                try:
                    resp = await client.get(
                        f"https://pastebin.com/search?q={target}",
                        headers=build_request_headers(),
                        timeout=10.0,
                        follow_redirects=True,
                    )
                    if resp.status_code == 200:
                        # Extract paste links from search results
                        links = re.findall(r'href="(/[a-zA-Z0-9]{8})"', resp.text)
                        for link in links[:5]:
                            all_results.append({
                                "title": f"Pastebin paste {link}",
                                "url": f"https://pastebin.com{link}",
                                "snippet": "",
                                "source": "direct",
                            })
                except Exception:
                    pass

    # Analyze results for leak indicators
    for result in all_results:
        matched_keywords = _check_snippet_for_leaks(
            f"{result.get('title', '')} {result.get('snippet', '')}"
        )

        leak_entry = {
            "url": result.get("url"),
            "title": result.get("title", "")[:200],
            "snippet": result.get("snippet", "")[:300],
            "source": result.get("source"),
            "leak_keywords_found": matched_keywords,
            "is_likely_leak": len(matched_keywords) >= 2,
        }

        # Check if this is a paste site specifically
        paste_domains = ["pastebin.com", "rentry.co", "paste.ee", "dpaste.org",
                         "ghostbin.com", "hastebin.com"]
        url = result.get("url", "").lower()
        leak_entry["is_paste_site"] = any(d in url for d in paste_domains)

        rich_data["paste_leaks"].append(leak_entry)

    rich_data["total_hits"] = len(rich_data["paste_leaks"])
    likely_leaks = [p for p in rich_data["paste_leaks"] if p.get("is_likely_leak")]

    if likely_leaks:
        rich_data["leak_detected"] = True
        rich_data["risk_level"] = "critical" if len(likely_leaks) >= 3 else "high"
    elif rich_data["paste_leaks"]:
        rich_data["risk_level"] = "medium"

    return rich_data if rich_data["paste_leaks"] else {}
