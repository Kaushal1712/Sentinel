"""Chat API — AI-powered chat-with-your-data interface.

Phase 2C-3: The eval()-based expression execution path has been replaced.
The new pipeline is:

  User message
      ↓
  generate_structured_query()  [ai_engine.py]  — LLM produces a JSON DataQuery
      ↓
  validate_query()             [query_engine.py] — strict allowlist validation
      ↓
  execute_query()              [query_engine.py] — deterministic pandas dispatch
      ↓
  Bounded DataFrame result
      ↓
  generate_insight()           [ai_engine.py]  — natural-language explanation
      ↓
  suggest_chart()              [ai_engine.py]  — chart configuration
      ↓
  ChatMessage persisted + API response

No eval(), exec(), compile(), or dynamic attribute access on LLM output occurs
anywhere in this module.
"""

import json
import logging

import pandas as pd
from flask import Blueprint, current_app, g, jsonify, request

from auth.middleware import require_auth
from core.query_engine import QueryValidationError, describe_query, execute_query, validate_query
from database import ChatMessage, Dataset, DatasetChunk, db
from limiter import limiter, user_rate_limit_key

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")
logger = logging.getLogger(__name__)

# Maximum character length we will store / return for a user error message
# (prevents a malformed LLM response leaking large amounts of internal detail).
_MAX_ERROR_PREVIEW: int = 200


def _df_result_to_json(df: pd.DataFrame) -> list[dict]:
    """Convert a DataFrame result to a JSON-serializable list of dicts."""
    return json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))


def _load_all_rows(dataset) -> list[dict]:
    """Load all dataset rows, using chunks when available.

    For datasets with ``chunks_migrated=True`` this fetches all
    ``DatasetChunk`` rows in order and concatenates them.  For legacy datasets
    (``chunks_migrated=False``) it falls back to deserializing ``data_json``.

    Chat always needs the full row set to build a Pandas DataFrame for the
    query engine.  The chunk path is not slower for this use-case — it reads
    the same total data volume, just in N smaller DB reads instead of one large
    TEXT column fetch.
    """
    if dataset.chunks_migrated:
        chunks = (
            DatasetChunk.query
            .filter_by(dataset_id=dataset.id)
            .order_by(DatasetChunk.chunk_index)
            .all()
        )
        rows: list[dict] = []
        for chunk in chunks:
            rows.extend(json.loads(chunk.rows_json))
        return rows
    # Legacy path
    return json.loads(dataset.data_json) if dataset.data_json else []


@chat_bp.route("/message", methods=["POST"])
@require_auth
@limiter.limit(
    lambda: current_app.config.get("DATASET_CHAT_RATE_LIMIT", "30 per hour"),
    key_func=user_rate_limit_key,
)
def send_message():
    """Process a chat message and return AI response with data.

    The dataset-chat flow no longer uses eval() in any form.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400

    message = (data.get("message") or "").strip()
    dataset_id = data.get("dataset_id")

    if not message:
        return jsonify({"error": "Message is required"}), 400
    if not dataset_id:
        return jsonify({"error": "Dataset ID is required"}), 400

    # Check OpenAI config
    if not current_app.config.get("OPENAI_API_KEY"):
        return jsonify({
            "error": "AI features require an OpenAI API key. Set OPENAI_API_KEY in your .env file."
        }), 503

    # Load dataset (ownership check included in filter)
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    if dataset.upload_status != "ready":
        return jsonify({"error": "Dataset is still processing"}), 400

    # Save user message
    user_msg = ChatMessage(
        user_id=g.current_user.id,
        dataset_id=dataset_id,
        role="user",
        content=message,
    )
    db.session.add(user_msg)
    db.session.commit()

    try:
        from core.ai_engine import generate_insight, generate_structured_query, suggest_chart

        # ── Build DataFrame from stored data ──────────────────────────────────
        raw_data = _load_all_rows(dataset)
        schema = json.loads(dataset.columns_json) if dataset.columns_json else []
        df = pd.DataFrame(raw_data)
        df_columns: set[str] = set(df.columns)

        # ── Step 1: LLM generates a structured DataQuery (JSON) ───────────────
        # This returns a dict parsed from the model's JSON output.
        # It is UNTRUSTED — treat as external user input.
        try:
            raw_query = generate_structured_query(message, schema, raw_data[:5])
        except json.JSONDecodeError:
            logger.warning(
                "LLM returned malformed JSON for dataset %s, user %s",
                dataset_id, g.current_user.id,
            )
            raw_query = {"operation": "filter", "filters": []}

        logger.info(
            "Raw structured query from LLM for dataset %s: %s",
            dataset_id, json.dumps(raw_query)[:500],
        )

        # ── Step 2: Validate the structured query ─────────────────────────────
        # validate_query() raises QueryValidationError on any policy violation.
        # All column names, operators, aggregations, and operation names are
        # checked against explicit allowlists.  No LLM output is executed.
        try:
            validated_q = validate_query(raw_query, df_columns)
        except QueryValidationError as exc:
            logger.warning(
                "Query validation failed for dataset %s, user %s: %s",
                dataset_id, g.current_user.id, exc,
            )
            # Fall back to a safe no-op query that returns the first N rows.
            validated_q = validate_query(
                {"operation": "select", "limit": 10}, df_columns
            )

        # ── Step 3: Execute the validated query ───────────────────────────────
        # execute_query() dispatches to explicit pandas methods only.
        # No eval(), exec(), or dynamic attribute access occurs here.
        result_df = execute_query(validated_q, df)
        result_data = _df_result_to_json(result_df)
        result_columns = list(result_df.columns)

        # Human-readable description of what the query does (replaces the old
        # Python expression string in stored / returned query_generated field).
        query_description = describe_query(validated_q)
        logger.info("Executed query for dataset %s: %s", dataset_id, query_description)

        # ── Step 4: Generate natural-language insight ─────────────────────────
        insight = generate_insight(message, result_data, result_columns)

        # ── Step 5: Suggest chart configuration ───────────────────────────────
        chart_config = suggest_chart(message, result_columns, result_data)

        # Cap data_result_json at 200 KB before DB write.
        result_json_str = json.dumps(result_data, default=str)
        cap_fired = False
        if len(result_json_str) > 200_000:
            cap_fired = True
            result_json_str = json.dumps(result_data[:10], default=str)
            result_json_str = result_json_str[:200_000]

        # Use the capped form for the API response too, so the response payload
        # honours the same bound as the stored value.
        response_result_data = json.loads(result_json_str) if cap_fired else result_data

        # Save assistant message
        assistant_msg = ChatMessage(
            user_id=g.current_user.id,
            dataset_id=dataset_id,
            role="assistant",
            content=insight,
            # query_generated now holds a human-readable description,
            # NOT executable Python code.
            query_generated=query_description,
            data_result_json=result_json_str,
            chart_config_json=json.dumps(chart_config) if chart_config else None,
        )
        db.session.add(assistant_msg)
        db.session.commit()

        return jsonify({
            "message": {
                "id": assistant_msg.id,
                "role": "assistant",
                "content": insight,
                # query_generated is a human-readable description (Phase 2C-3).
                "query_generated": query_description,
                # Return the 200 KB-capped result, consistent with what is stored.
                "data_result": response_result_data,
                "chart_config": chart_config,
                "created_at": assistant_msg.created_at.isoformat(),
            }
        }), 200

    except RuntimeError as e:
        # OpenAI not configured or authentication failed.
        # Log the provider detail server-side only — it must not be stored in the
        # ChatMessage or returned to the client because it may reveal API key hints
        # or provider configuration details.
        logger.warning(
            "Chat AI unavailable for dataset %s, user %s: %s",
            dataset_id, g.current_user.id, e,
        )
        assistant_msg = ChatMessage(
            user_id=g.current_user.id,
            dataset_id=dataset_id,
            role="assistant",
            content="⚠️ AI service temporarily unavailable. Please try again later.",
        )
        db.session.add(assistant_msg)
        db.session.commit()
        return jsonify({"message": assistant_msg.to_dict()}), 200

    except Exception:
        logger.exception("Chat processing failed for dataset %s, user %s", dataset_id, g.current_user.id)
        # Generic client-safe message — no internal details, no str(e)
        error_content = "I encountered an error analyzing your data. Please try rephrasing your question."
        assistant_msg = ChatMessage(
            user_id=g.current_user.id,
            dataset_id=dataset_id,
            role="assistant",
            content=error_content,
        )
        db.session.add(assistant_msg)
        db.session.commit()
        return jsonify({"message": assistant_msg.to_dict()}), 200


@chat_bp.route("/history/<int:dataset_id>", methods=["GET"])
@require_auth
def get_chat_history(dataset_id):
    """Get chat history for a dataset.

    Returns the most-recent ``limit`` messages (default 100, max 200).
    Older messages are excluded from this response; clients that need the full
    history should use the ``?limit=`` parameter or implement pagination.

    Response fields:
      messages  — list of ChatMessage dicts, chronological order
      total     — total number of messages stored (may exceed len(messages))
      limited   — true if total > limit (i.e. older messages were omitted)
    """
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    # Validate user-supplied limit: clamp to [1, 200].
    # Default 100 — enough for a typical session without unbounded memory use.
    _MAX_HISTORY_LIMIT = 200
    _DEFAULT_HISTORY_LIMIT = 100
    try:
        limit = int(request.args.get("limit", _DEFAULT_HISTORY_LIMIT))
    except (TypeError, ValueError):
        limit = _DEFAULT_HISTORY_LIMIT
    limit = max(1, min(limit, _MAX_HISTORY_LIMIT))

    # Count total messages first (cheap COUNT query — no blob deserialization).
    total = ChatMessage.query.filter_by(
        user_id=g.current_user.id,
        dataset_id=dataset_id,
    ).count()

    # Fetch only the most recent `limit` messages, then reverse for chronological
    # display.  Using ORDER BY desc + LIMIT avoids loading the full history when
    # the conversation is long.
    recent = ChatMessage.query.filter_by(
        user_id=g.current_user.id,
        dataset_id=dataset_id,
    ).order_by(ChatMessage.created_at.desc()).limit(limit).all()

    # Reverse to restore chronological order for the client.
    recent.reverse()

    return jsonify({
        "messages": [m.to_dict() for m in recent],
        "total": total,
        "limited": total > limit,
    }), 200


@chat_bp.route("/history/<int:dataset_id>", methods=["DELETE"])
@require_auth
def clear_chat_history(dataset_id):
    """Clear chat history for a dataset."""
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    ChatMessage.query.filter_by(
        user_id=g.current_user.id,
        dataset_id=dataset_id,
    ).delete()
    db.session.commit()

    return jsonify({"message": "Chat history cleared"}), 200
