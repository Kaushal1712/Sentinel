"""Email intelligence plugin — enriches discovered emails with identity and breach data."""

import os
import re
import logging

import httpx

logger = logging.getLogger(__name__)


def _get_key(name: str) -> str | None:
    """Retrieve an API key from Flask config or environment."""
    try:
        from flask import current_app
        key = current_app.config.get(name)
        if key:
            return key
    except Exception:
        pass
    return os.environ.get(name) or None


def generate_permutations(email: str) -> list[str]:
    """Generate common corporate email permutations from an email address."""
    local, domain = email.split("@", 1) if "@" in email else (email, "")
    if not domain:
        return []

    # Try to split local part into first/last name
    parts = re.split(r"[._\-]", local)
    if len(parts) < 2:
        return []

    first = parts[0].lower()
    last = parts[-1].lower()

    permutations = [
        f"{first}.{last}@{domain}",
        f"{first}{last}@{domain}",
        f"{first[0]}{last}@{domain}",
        f"{first}_{last}@{domain}",
        f"{first}-{last}@{domain}",
        f"{last}.{first}@{domain}",
        f"{last}{first}@{domain}",
        f"{first[0]}.{last}@{domain}",
        f"{first}@{domain}",
        f"{last}@{domain}",
    ]

    # Deduplicate and exclude the original
    seen = {email.lower()}
    unique = []
    for p in permutations:
        if p.lower() not in seen:
            seen.add(p.lower())
            unique.append(p)

    return unique


async def enrich_via_clearbit(email: str, client: httpx.AsyncClient) -> dict:
    """Enrich email via Clearbit free person API."""
    try:
        resp = await client.get(
            f"https://person.clearbit.com/v2/combined/find",
            params={"email": email},
            headers={"Authorization": f"Bearer {_get_key('CLEARBIT_API_KEY')}"},
            timeout=10.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            person = data.get("person", {})
            company = data.get("company", {})
            return {
                "name": person.get("name", {}).get("fullName"),
                "title": person.get("employment", {}).get("title"),
                "company": company.get("name"),
                "company_domain": company.get("domain"),
                "linkedin": person.get("linkedin", {}).get("handle"),
                "twitter": person.get("twitter", {}).get("handle"),
                "github": person.get("github", {}).get("handle"),
                "avatar": person.get("avatar"),
                "location": person.get("geo", {}).get("city"),
                "source": "clearbit",
            }
    except Exception as e:
        logger.debug(f"Clearbit enrichment error for {email}: {e}")

    return {}


async def verify_via_hunter(email: str, client: httpx.AsyncClient) -> dict:
    """Verify an email address using the Hunter.io API."""
    api_key = _get_key("HUNTER_API_KEY")
    if not api_key:
        return {}

    try:
        resp = await client.get(
            "https://api.hunter.io/v2/email-verifier",
            params={"email": email, "api_key": api_key},
            timeout=10.0,
        )
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            return {
                "status": data.get("status"),  # valid, invalid, accept_all, webmail, disposable
                "score": data.get("score"),
                "disposable": data.get("disposable"),
                "webmail": data.get("webmail"),
                "mx_records": data.get("mx_records"),
                "source": "hunter",
            }
    except Exception as e:
        logger.debug(f"Hunter.io verification error for {email}: {e}")

    return {}


async def analyze_email(email: str, client: httpx.AsyncClient) -> dict:
    """Full email intelligence: permutations, verification, enrichment."""
    if not email or "@" not in email:
        return {}

    rich_data = {
        "email": email,
        "permutations": [],
        "verification": {},
        "enrichment": {},
        "domain_info": {},
    }

    # Generate permutations
    perms = generate_permutations(email)
    rich_data["permutations"] = perms[:8]  # Limit to 8

    # Domain analysis
    domain = email.split("@")[1]
    common_providers = {
        "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
        "protonmail.com", "icloud.com", "aol.com", "mail.com",
    }
    rich_data["domain_info"] = {
        "domain": domain,
        "is_personal": domain.lower() in common_providers,
        "is_corporate": domain.lower() not in common_providers,
    }

    # Verification via Hunter.io (if key available)
    hunter_key = _get_key("HUNTER_API_KEY")
    if hunter_key:
        rich_data["verification"] = await verify_via_hunter(email, client)

    # Enrichment via Clearbit (if key available)
    clearbit_key = _get_key("CLEARBIT_API_KEY")
    if clearbit_key:
        rich_data["enrichment"] = await enrich_via_clearbit(email, client)

    return {k: v for k, v in rich_data.items() if v is not None and v != "" and v != {} and v != []}
