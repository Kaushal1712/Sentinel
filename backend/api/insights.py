"""Insights API — AI-powered auto-insights generation for datasets."""

import json
import logging

from flask import Blueprint, current_app, g, jsonify
from auth.middleware import require_auth
from database import Dataset, DatasetChunk, db
from limiter import limiter, user_rate_limit_key

insights_bp = Blueprint("insights", __name__, url_prefix="/api/insights")
logger = logging.getLogger(__name__)


@insights_bp.route("/<int:dataset_id>/generate", methods=["POST"])
@require_auth
@limiter.limit(
    lambda: current_app.config.get("DATASET_INSIGHTS_RATE_LIMIT", "10 per hour"),
    key_func=user_rate_limit_key,
)
def generate_insights(dataset_id):
    """Generate AI-powered insights for a dataset."""
    if not current_app.config.get("OPENAI_API_KEY"):
        return jsonify({
            "error": "AI features require an OpenAI API key. Set OPENAI_API_KEY in your .env file.",
        }), 503

    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    if dataset.upload_status != "ready":
        return jsonify({"error": "Dataset is still processing"}), 400

    try:
        from core.ai_engine import generate_auto_insights

        summary = json.loads(dataset.summary_json) if dataset.summary_json else {}
        columns = json.loads(dataset.columns_json) if dataset.columns_json else []
        # generate_auto_insights only uses raw_data[:5] (10 rows at most are
        # passed, 5 used in the prompt).  For migrated datasets, read only the
        # first chunk (≤500 rows) rather than deserializing the entire dataset.
        if dataset.chunks_migrated:
            first_chunk = (
                DatasetChunk.query
                .filter_by(dataset_id=dataset_id, chunk_index=0)
                .first()
            )
            raw_data = json.loads(first_chunk.rows_json) if first_chunk else []
        else:
            raw_data = json.loads(dataset.data_json) if dataset.data_json else []

        insights = generate_auto_insights(summary, columns, raw_data[:10])

        return jsonify({
            "insights": insights,
            "dataset_id": dataset_id,
            "dataset_name": dataset.name,
        }), 200

    except RuntimeError as e:
        # OpenAI not configured or authentication failed.
        # Log the detail server-side; the provider error text must not reach the client
        # because it may contain hints about the API key or provider configuration.
        logger.warning("Insight generation unavailable for dataset %s: %s", dataset_id, e)
        return jsonify({"error": "AI service temporarily unavailable."}), 503
    except Exception:
        logger.exception("Insight generation failed for dataset %s", dataset_id)
        return jsonify({"error": "Failed to generate insights. Please try again."}), 500


@insights_bp.route("/<int:dataset_id>/summary", methods=["GET"])
@require_auth
def get_dataset_summary(dataset_id):
    """Get statistical summary without AI (works without OpenAI key)."""
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    try:
        summary = json.loads(dataset.summary_json) if dataset.summary_json else {}
        columns = json.loads(dataset.columns_json) if dataset.columns_json else []
    except (json.JSONDecodeError, ValueError):
        logger.exception(
            "Corrupted summary/columns JSON for dataset %s, user %s",
            dataset_id, g.current_user.id,
        )
        return jsonify({"error": "Dataset metadata is unavailable."}), 500

    # Generate rule-based insights (no AI required)
    basic_insights = []

    # Missing data insight
    total_missing = summary.get("total_missing", 0)
    total_cells = dataset.row_count * dataset.column_count
    if total_missing > 0 and total_cells > 0:
        pct = round(total_missing / total_cells * 100, 1)
        basic_insights.append({
            "title": "Missing Data Detected",
            "description": f"{total_missing} missing values found across the dataset ({pct}% of all cells). "
                           f"Consider data imputation strategies for affected columns.",
            "type": "summary",
            "importance": "high" if pct > 10 else "medium",
            "relatedColumns": [c["name"] for c in columns if c.get("missing_count", 0) > 0],
        })

    # Duplicates insight
    dupes = summary.get("total_duplicates", 0)
    if dupes > 0:
        basic_insights.append({
            "title": "Duplicate Rows Found",
            "description": f"{dupes} duplicate rows detected ({round(dupes / max(dataset.row_count, 1) * 100, 1)}% of data). "
                           f"These may indicate data entry errors or redundant records.",
            "type": "outlier",
            "importance": "medium",
            "relatedColumns": [],
        })

    # High cardinality columns
    for col in columns:
        if col["dtype"] in ("integer", "float") and col.get("std") is not None:
            mean_val = col.get("mean", 0)
            std_val = col.get("std", 0)
            if mean_val and std_val / abs(mean_val) > 1:
                basic_insights.append({
                    "title": f"High Variance in '{col['name']}'",
                    "description": f"Column '{col['name']}' shows high variance (std={std_val}, mean={mean_val}). "
                                   f"Range: {col.get('min')} to {col.get('max')}.",
                    "type": "distribution",
                    "importance": "medium",
                    "relatedColumns": [col["name"]],
                })

    # Correlations
    correlations = summary.get("top_correlations", [])
    for corr in correlations[:3]:
        direction = "positive" if corr["value"] > 0 else "negative"
        strength = "strong" if abs(corr["value"]) > 0.7 else "moderate"
        basic_insights.append({
            "title": f"{strength.title()} {direction} correlation",
            "description": f"'{corr['col1']}' and '{corr['col2']}' have a {strength} {direction} "
                           f"correlation of {corr['value']}.",
            "type": "correlation",
            "importance": "high" if abs(corr["value"]) > 0.7 else "medium",
            "relatedColumns": [corr["col1"], corr["col2"]],
        })

    return jsonify({
        "summary": summary,
        "columns": columns,
        "insights": basic_insights,
        "dataset_id": dataset_id,
    }), 200
