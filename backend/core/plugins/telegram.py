"""Telegram OSINT plugin — checks t.me profile pages for public accounts."""

import re
import logging

import httpx
from core.http_client import build_request_headers

logger = logging.getLogger(__name__)


async def analyze(username: str, client: httpx.AsyncClient) -> dict:
    """Extract public profile data from Telegram via t.me preview page."""
    rich_data = {
        "display_name": None,
        "bio": None,
        "member_count": None,
        "account_type": None,  # personal, bot, channel, group
        "profile_photo_url": None,
    }

    try:
        headers = build_request_headers()
        resp = await client.get(
            f"https://t.me/{username}",
            headers=headers,
            follow_redirects=True,
            timeout=10.0,
        )

        if resp.status_code != 200:
            return {}

        html = resp.text

        # Check if this is a valid profile (Telegram returns 200 for non-existent too)
        if "tgme_page_title" not in html and "tgme_channel_info" not in html:
            # Might be a minimal personal profile — check for preview button
            if "tgme_action_button_new" not in html:
                return {}

        # Display name
        title_match = re.search(
            r'class="tgme_page_title"[^>]*>.*?<span[^>]*>(.*?)</span>',
            html, re.DOTALL
        )
        if title_match:
            rich_data["display_name"] = re.sub(r"<[^>]+>", "", title_match.group(1)).strip()

        # Bio / description
        desc_match = re.search(
            r'class="tgme_page_description[^"]*"[^>]*>(.*?)</div>',
            html, re.DOTALL
        )
        if desc_match:
            rich_data["bio"] = re.sub(r"<[^>]+>", "", desc_match.group(1)).strip()[:500]

        # Member / subscriber count
        extra_match = re.search(
            r'class="tgme_page_extra"[^>]*>(.*?)</div>',
            html, re.DOTALL
        )
        if extra_match:
            extra_text = extra_match.group(1).strip().lower()
            count_match = re.search(r"([\d\s]+)", extra_text)
            if count_match:
                try:
                    rich_data["member_count"] = int(count_match.group(1).replace(" ", ""))
                except ValueError:
                    pass

            # Determine account type
            if "subscriber" in extra_text:
                rich_data["account_type"] = "channel"
            elif "member" in extra_text:
                rich_data["account_type"] = "group"
            elif "bot" in extra_text or username.lower().endswith("bot"):
                rich_data["account_type"] = "bot"
            else:
                rich_data["account_type"] = "personal"
        else:
            # Check for bot indicator
            if username.lower().endswith("bot"):
                rich_data["account_type"] = "bot"
            else:
                rich_data["account_type"] = "personal"

        # Profile photo
        photo_match = re.search(
            r'class="tgme_page_photo_image"[^>]*>.*?src="([^"]+)"',
            html, re.DOTALL
        )
        if photo_match:
            rich_data["profile_photo_url"] = photo_match.group(1)

        # If we got a display name, this is a valid profile
        if not rich_data["display_name"]:
            # Fallback: check action button as proof of existence
            if "tgme_action_button_new" in html:
                rich_data["display_name"] = username
                rich_data["account_type"] = rich_data["account_type"] or "personal"
            else:
                return {}

    except Exception as e:
        logger.warning(f"Telegram plugin error for {username}: {e}")
        return {}

    return {k: v for k, v in rich_data.items() if v is not None and v != ""}
