"""Phone number OSINT plugin — enriches extracted phone numbers."""

import os
import re
import logging

import httpx

logger = logging.getLogger(__name__)

# Common country code prefixes for fallback identification
COUNTRY_PREFIXES = {
    "1": "US/CA", "7": "RU", "20": "EG", "27": "ZA", "30": "GR",
    "31": "NL", "32": "BE", "33": "FR", "34": "ES", "36": "HU",
    "39": "IT", "40": "RO", "41": "CH", "43": "AT", "44": "GB",
    "45": "DK", "46": "SE", "47": "NO", "48": "PL", "49": "DE",
    "51": "PE", "52": "MX", "53": "CU", "54": "AR", "55": "BR",
    "56": "CL", "57": "CO", "58": "VE", "60": "MY", "61": "AU",
    "62": "ID", "63": "PH", "64": "NZ", "65": "SG", "66": "TH",
    "81": "JP", "82": "KR", "84": "VN", "86": "CN", "90": "TR",
    "91": "IN", "92": "PK", "93": "AF", "94": "LK", "95": "MM",
    "98": "IR", "212": "MA", "213": "DZ", "216": "TN", "218": "LY",
    "220": "GM", "221": "SN", "234": "NG", "254": "KE", "255": "TZ",
    "256": "UG", "260": "ZM", "263": "ZW", "351": "PT", "352": "LU",
    "353": "IE", "354": "IS", "358": "FI", "370": "LT", "371": "LV",
    "372": "EE", "380": "UA", "381": "RS", "385": "HR", "386": "SI",
    "420": "CZ", "421": "SK", "852": "HK", "853": "MO", "855": "KH",
    "856": "LA", "880": "BD", "886": "TW", "960": "MV", "961": "LB",
    "962": "JO", "963": "SY", "964": "IQ", "965": "KW", "966": "SA",
    "967": "YE", "968": "OM", "971": "AE", "972": "IL", "973": "BH",
    "974": "QA", "975": "BT", "976": "MN", "977": "NP", "992": "TJ",
    "993": "TM", "994": "AZ", "995": "GE", "996": "KG", "998": "UZ",
}

LINE_TYPES = {"mobile", "landline", "voip", "toll_free", "premium_rate"}


def _identify_country_by_prefix(phone: str) -> dict:
    """Identify country from phone prefix using built-in table."""
    cleaned = re.sub(r"[^\d]", "", phone)
    if cleaned.startswith("0"):
        return {"country": "Unknown", "prefix_match": False}

    # Try 3-digit, 2-digit, then 1-digit prefixes
    for length in (3, 2, 1):
        prefix = cleaned[:length]
        if prefix in COUNTRY_PREFIXES:
            return {
                "country_code": COUNTRY_PREFIXES[prefix],
                "dialing_prefix": f"+{prefix}",
                "prefix_match": True,
            }

    return {"country": "Unknown", "prefix_match": False}


def _get_api_key() -> str | None:
    """Retrieve the Numverify API key."""
    try:
        from flask import current_app
        key = current_app.config.get("NUMVERIFY_API_KEY")
        if key:
            return key
    except Exception:
        pass
    return os.environ.get("NUMVERIFY_API_KEY") or None


async def analyze_phone(phone: str, client: httpx.AsyncClient) -> dict:
    """Enrich a phone number with carrier and location data."""
    cleaned = re.sub(r"[^\d+]", "", phone)
    if len(cleaned) < 7:
        return {}

    rich_data = {
        "phone": phone,
        "cleaned": cleaned,
        "valid": None,
        "carrier": None,
        "line_type": None,
        "country": None,
        "country_code": None,
        "location": None,
    }

    api_key = _get_api_key()

    if api_key:
        try:
            number = cleaned.lstrip("+")
            resp = await client.get(
                "http://apilayer.net/api/validate",
                params={
                    "access_key": api_key,
                    "number": number,
                    "country_code": "",
                    "format": "1",
                },
                timeout=10.0,
            )

            if resp.status_code == 200:
                data = resp.json()
                if data.get("valid") is not None:
                    rich_data["valid"] = data.get("valid")
                    rich_data["carrier"] = data.get("carrier") or None
                    rich_data["line_type"] = data.get("line_type") or None
                    rich_data["country"] = data.get("country_name") or None
                    rich_data["country_code"] = data.get("country_code") or None
                    rich_data["location"] = data.get("location") or None
                    rich_data["international_format"] = data.get("international_format")

        except Exception as e:
            logger.debug(f"Numverify API error for {phone}: {e}")

    # Fallback: regex-based country identification
    if not rich_data.get("country_code"):
        prefix_data = _identify_country_by_prefix(cleaned)
        rich_data.update(prefix_data)

    return {k: v for k, v in rich_data.items() if v is not None and v != ""}
