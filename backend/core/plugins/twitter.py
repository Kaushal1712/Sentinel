"""Twitter/X OSINT plugin — scrapes public profiles via Nitter mirrors."""

import re
import logging
from datetime import datetime, timezone

import httpx
from core.http_client import build_request_headers

logger = logging.getLogger(__name__)

NITTER_INSTANCES = [
    "https://nitter.net",
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
]


def _parse_stat(text: str) -> int:
    """Convert '1.2K' / '3.4M' style strings to integers."""
    text = (text or "").strip().replace(",", "")
    multipliers = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    for suffix, mult in multipliers.items():
        if text.upper().endswith(suffix):
            try:
                return int(float(text[:-1]) * mult)
            except ValueError:
                return 0
    try:
        return int(text)
    except ValueError:
        return 0


def _extract_text(html: str, pattern: str, default: str = "") -> str:
    """Extract first regex group from HTML."""
    match = re.search(pattern, html, re.DOTALL)
    return match.group(1).strip() if match else default


async def analyze(username: str, client: httpx.AsyncClient) -> dict:
    """Extract rich OSINT data from Twitter/X via Nitter mirrors."""
    rich_data = {
        "display_name": None,
        "bio": None,
        "location": None,
        "website": None,
        "join_date": None,
        "tweets": 0,
        "followers": 0,
        "following": 0,
        "avatar_url": None,
        "banner_url": None,
        "recent_tweets": [],
        "is_verified": False,
    }

    html = None
    used_instance = None

    for instance in NITTER_INSTANCES:
        try:
            headers = build_request_headers()
            resp = await client.get(
                f"{instance}/{username}",
                headers=headers,
                follow_redirects=True,
                timeout=10.0,
            )
            if resp.status_code == 200 and "profile-card" in resp.text.lower():
                html = resp.text
                used_instance = instance
                break
        except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPError):
            continue

    if not html:
        return {}

    try:
        # Display name
        rich_data["display_name"] = _extract_text(
            html, r'class="profile-card-fullname"[^>]*>([^<]+)<'
        )

        # Bio
        rich_data["bio"] = _extract_text(
            html, r'class="profile-bio"[^>]*>(.*?)</p>', ""
        )
        if rich_data["bio"]:
            rich_data["bio"] = re.sub(r"<[^>]+>", "", rich_data["bio"]).strip()

        # Location
        rich_data["location"] = _extract_text(
            html, r'class="profile-location"[^>]*>(?:<[^>]+>)*([^<]+)'
        )

        # Website
        website_match = re.search(
            r'class="profile-website"[^>]*>.*?href="([^"]+)"', html, re.DOTALL
        )
        if website_match:
            rich_data["website"] = website_match.group(1)

        # Join date
        rich_data["join_date"] = _extract_text(
            html, r'class="profile-joindate"[^>]*>(?:<[^>]+>)*([^<]+)'
        )

        # Stats (tweets, following, followers)
        stat_items = re.findall(
            r'class="profile-stat-num"[^>]*>([^<]+)<', html
        )
        if len(stat_items) >= 4:
            rich_data["tweets"] = _parse_stat(stat_items[0])
            rich_data["following"] = _parse_stat(stat_items[1])
            rich_data["followers"] = _parse_stat(stat_items[2])

        # Avatar
        avatar_match = re.search(
            r'class="profile-card-avatar"[^>]*>.*?src="([^"]+)"', html, re.DOTALL
        )
        if avatar_match:
            avatar_url = avatar_match.group(1)
            if avatar_url.startswith("/"):
                avatar_url = f"{used_instance}{avatar_url}"
            rich_data["avatar_url"] = avatar_url

        # Recent tweets
        tweet_blocks = re.findall(
            r'class="tweet-content[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL
        )
        now = datetime.now(timezone.utc)
        for i, tweet_html in enumerate(tweet_blocks[:5]):
            tweet_text = re.sub(r"<[^>]+>", "", tweet_html).strip()[:280]
            rich_data["recent_tweets"].append({
                "text": tweet_text,
                "index": i,
            })

        # Last active: if we found tweets, mark as active
        if rich_data["recent_tweets"]:
            rich_data["last_active_at"] = now.isoformat()

        # Verified badge
        if "verified" in html.lower():
            rich_data["is_verified"] = True

    except Exception as e:
        logger.warning(f"Twitter plugin parse error for {username}: {e}")

    return {k: v for k, v in rich_data.items() if v is not None and v != "" and v != []}
