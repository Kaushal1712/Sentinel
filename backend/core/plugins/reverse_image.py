"""Reverse image search plugin — finds where a profile picture appears across the web."""

import os
import logging

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


async def _search_google_vision(image_url: str, api_key: str,
                                 client: httpx.AsyncClient) -> list:
    """Use Google Cloud Vision Web Detection to find matching images."""
    results = []
    try:
        resp = await client.post(
            f"https://vision.googleapis.com/v1/images:annotate",
            params={"key": api_key},
            json={
                "requests": [{
                    "image": {"source": {"imageUri": image_url}},
                    "features": [{"type": "WEB_DETECTION", "maxResults": 10}],
                }]
            },
            timeout=20.0,
        )

        if resp.status_code == 200:
            data = resp.json()
            annotations = (
                data.get("responses", [{}])[0]
                .get("webDetection", {})
            )

            # Pages with matching images
            for page in annotations.get("pagesWithMatchingImages", [])[:10]:
                results.append({
                    "url": page.get("url", ""),
                    "title": page.get("pageTitle", ""),
                    "match_type": "page_with_image",
                    "source": "google_vision",
                })

            # Visually similar images
            for img in annotations.get("visuallySimilarImages", [])[:5]:
                results.append({
                    "url": img.get("url", ""),
                    "match_type": "visually_similar",
                    "source": "google_vision",
                })

            # Full matching images
            for img in annotations.get("fullMatchingImages", [])[:5]:
                results.append({
                    "url": img.get("url", ""),
                    "match_type": "full_match",
                    "source": "google_vision",
                })

            # Best guess labels
            for label in annotations.get("bestGuessLabels", []):
                results.append({
                    "label": label.get("label", ""),
                    "match_type": "best_guess",
                    "source": "google_vision",
                })

    except Exception as e:
        logger.debug(f"Google Vision API error: {e}")

    return results


def _build_tineye_url(image_url: str) -> str:
    """Build a TinEye search URL for manual lookup."""
    from urllib.parse import quote
    return f"https://tineye.com/search?url={quote(image_url, safe='')}"


def _build_google_lens_url(image_url: str) -> str:
    """Build a Google Lens search URL for manual lookup."""
    from urllib.parse import quote
    return f"https://lens.google.com/uploadbyurl?url={quote(image_url, safe='')}"


async def analyze(image_urls: list[str],
                  client: httpx.AsyncClient | None = None) -> dict:
    """Perform reverse image search on a list of profile picture URLs."""
    if not image_urls:
        return {}

    rich_data = {
        "images_analyzed": 0,
        "matches": [],
        "manual_search_links": [],
        "face_matches_found": False,
    }

    from core.http_client import create_async_client

    if client is None:
        async with create_async_client() as c:
            return await _run_analysis(image_urls, c, rich_data)
    else:
        return await _run_analysis(image_urls, client, rich_data)


async def _run_analysis(image_urls: list[str],
                        client: httpx.AsyncClient,
                        rich_data: dict) -> dict:
    """Execute reverse image search across available APIs."""
    vision_key = _get_key("GOOGLE_VISION_KEY")

    for img_url in image_urls[:5]:  # Limit to 5 images
        rich_data["images_analyzed"] += 1

        if vision_key:
            api_results = await _search_google_vision(img_url, vision_key, client)
            rich_data["matches"].extend(api_results)

            if any(r.get("match_type") == "full_match" for r in api_results):
                rich_data["face_matches_found"] = True

        # Always add manual search links as fallback
        rich_data["manual_search_links"].append({
            "image_url": img_url,
            "tineye": _build_tineye_url(img_url),
            "google_lens": _build_google_lens_url(img_url),
        })

    return rich_data if (rich_data["matches"] or rich_data["manual_search_links"]) else {}
