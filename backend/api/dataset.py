"""Dataset API — Upload, clean, and analyze datasets."""

import io
import json
import logging
import os
import zipfile

import pandas as pd
from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.utils import secure_filename

from auth.middleware import require_auth
from database import CHUNK_SIZE, Dataset, DatasetChunk, db
from limiter import limiter, user_rate_limit_key

dataset_bp = Blueprint("dataset", __name__, url_prefix="/api/dataset")
logger = logging.getLogger(__name__)

# ─── Magic-byte signatures ────────────────────────────────────────────────────
# XLSX files are ZIP archives; the first 4 bytes are the PK\x03\x04 local-file
# header signature.  This lets us reject a renamed binary without depending on
# an external libmagic binding.
_XLSX_MAGIC = b"PK\x03\x04"

# Legacy XLS files use the Microsoft Compound Document (OLE2) container.
# Its 8-byte signature is well-known and stable across all BIFF versions.
_XLS_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# Maximum length we will accept for a stored filename.
_MAX_FILENAME_LENGTH = 200


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _ensure_upload_dir():
    folder = current_app.config.get("UPLOAD_FOLDER", "uploads")
    os.makedirs(folder, exist_ok=True)
    return folder


def _detect_dtype(series: pd.Series) -> str:
    """Classify a pandas Series into a human-friendly type."""
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_float_dtype(series):
        return "float"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"

    # Try to parse as datetime
    try:
        pd.to_datetime(series.dropna().head(20))
        return "datetime"
    except (ValueError, TypeError):
        pass

    # Check if categorical (few unique values relative to total)
    nunique = series.nunique()
    if 0 < nunique <= 20 and nunique / max(len(series), 1) < 0.3:
        return "categorical"

    return "text"


def _generate_column_summary(df: pd.DataFrame) -> list[dict]:
    """Generate per-column summary metadata."""
    columns = []
    for col in df.columns:
        series = df[col]
        dtype = _detect_dtype(series)
        info = {
            "name": col,
            "dtype": dtype,
            "missing_count": int(series.isna().sum()),
            "missing_pct": round(float(series.isna().mean()) * 100, 1),
            "unique_count": int(series.nunique()),
        }

        if dtype in ("integer", "float"):
            desc = series.describe()
            info.update({
                "min": _safe_num(desc.get("min")),
                "max": _safe_num(desc.get("max")),
                "mean": _safe_num(desc.get("mean")),
                "median": _safe_num(series.median()),
                "std": _safe_num(desc.get("std")),
            })
        elif dtype == "categorical":
            top_values = series.value_counts().head(10).to_dict()
            info["top_values"] = {str(k): int(v) for k, v in top_values.items()}

        columns.append(info)
    return columns


def _generate_summary_stats(df: pd.DataFrame, column_info: list[dict]) -> dict:
    """Generate dataset-level summary statistics."""
    numeric_cols = [c["name"] for c in column_info if c["dtype"] in ("integer", "float")]
    categorical_cols = [c["name"] for c in column_info if c["dtype"] == "categorical"]

    summary = {
        "total_rows": len(df),
        "total_columns": len(df.columns),
        "total_missing": int(df.isna().sum().sum()),
        "total_duplicates": int(df.duplicated().sum()),
        "numeric_columns": len(numeric_cols),
        "categorical_columns": len(categorical_cols),
        "memory_usage_bytes": int(df.memory_usage(deep=True).sum()),
    }

    # Correlation matrix for numeric columns
    if len(numeric_cols) >= 2:
        try:
            corr = df[numeric_cols].corr()
            # Find top correlations (excluding self-correlation)
            correlations = []
            for i, col1 in enumerate(numeric_cols):
                for col2 in numeric_cols[i + 1:]:
                    val = corr.loc[col1, col2]
                    if pd.notna(val) and abs(val) > 0.3:
                        correlations.append({
                            "col1": col1, "col2": col2,
                            "value": round(float(val), 3),
                        })
            correlations.sort(key=lambda x: abs(x["value"]), reverse=True)
            summary["top_correlations"] = correlations[:10]
        except Exception:
            summary["top_correlations"] = []

    return summary


def _safe_num(val):
    """Convert numpy/pandas numbers to native Python for JSON serialization."""
    if val is None or (hasattr(val, '__class__') and 'nat' in str(type(val)).lower()):
        return None
    try:
        f = float(val)
        return round(f, 4) if f != int(f) else int(f)
    except (TypeError, ValueError):
        return None


def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Auto-clean a DataFrame: strip whitespace, remove full-empty rows/cols."""
    # Strip string column whitespace. Trim element-wise and only for real str
    # values: the ``.str`` accessor raises on non-string object columns and
    # turns non-string cells (numbers, bools, dates) into NaN in mixed columns.
    for col in df.select_dtypes(include=["object"]).columns:
        df[col] = df[col].map(lambda v: v.strip() if isinstance(v, str) else v)

    # Drop columns that are entirely empty
    df = df.dropna(axis=1, how="all")

    # Drop rows that are entirely empty
    df = df.dropna(axis=0, how="all")

    # Try to convert numeric-looking string columns. Only convert when every
    # non-missing value parses as a number; a coercion that would turn genuine
    # text cells into NaN would silently destroy data in mixed-type columns.
    for col in df.select_dtypes(include=["object"]).columns:
        try:
            converted = pd.to_numeric(df[col], errors="coerce")
            if (
                converted.notna().sum() / max(len(df), 1) > 0.5
                and converted.notna().sum() == df[col].notna().sum()
            ):
                df[col] = converted
        except Exception:
            pass

    return df


def _df_to_json_rows(df: pd.DataFrame, max_rows: int = 10000) -> list[dict]:
    """Convert DataFrame to list of dicts, handling numpy types."""
    subset = df.head(max_rows)
    # Use pandas to_dict which handles type conversion
    records = json.loads(subset.to_json(orient="records", date_format="iso", default_handler=str))
    return records


def _build_chunks(rows: list[dict]) -> list[str]:
    """Serialise *rows* into a list of JSON strings, each covering CHUNK_SIZE rows.

    Returns an ordered list of ``rows_json`` values ready to be stored as
    ``DatasetChunk.rows_json``.  Each element is a JSON array string.
    Calling code is responsible for inserting the chunks with the correct
    ``chunk_index`` and setting ``Dataset.chunks_migrated = True`` only after
    all chunks have been committed.
    """
    result = []
    for start in range(0, max(len(rows), 1), CHUNK_SIZE):
        batch = rows[start: start + CHUNK_SIZE]
        result.append(json.dumps(batch, default=str))
    return result


def _validate_content(file_bytes: bytes, ext: str) -> str | None:
    """Light-weight content validation using magic bytes / stdlib only.

    Returns None if the content is acceptable, or a human-readable rejection
    reason string if it should be rejected.

    This check does NOT execute any file content or follow external references.
    It is a first-pass sanity gate to reject obviously mismatched uploads (e.g.
    a JPEG renamed to .xlsx) without depending on external libmagic bindings.

    Limitation: content-based validation cannot guarantee safety against every
    parser vulnerability.  The downstream pandas/openpyxl parser is the second
    line of defence and is wrapped in a generic exception handler.
    """
    if ext in (".xlsx",):
        # XLSX files are ZIP archives.  Verify the PK local-file-header magic
        # and that stdlib can open it as a ZIP without errors.
        if not file_bytes[:4] == _XLSX_MAGIC:
            return "The uploaded file does not appear to be a valid XLSX workbook."
        if not zipfile.is_zipfile(io.BytesIO(file_bytes)):
            return "The uploaded file could not be verified as a valid XLSX workbook."

    elif ext == ".xls":
        # Legacy XLS (OLE2/BIFF).  The 8-byte magic signature is stable.
        if len(file_bytes) < 8 or file_bytes[:8] != _XLS_MAGIC:
            return "The uploaded file does not appear to be a valid XLS workbook."

    elif ext == ".csv":
        # CSVs have no reliable magic bytes; any text-like content is plausible.
        # We reject files that contain null bytes — a strong indicator of binary
        # content passed off as text.  Genuine CSV data virtually never contains
        # null bytes.
        if b"\x00" in file_bytes[:4096]:
            return "The uploaded CSV file appears to contain binary content and cannot be processed."

    return None


# ─── Upload endpoint ──────────────────────────────────────────────────────────

@dataset_bp.route("/upload", methods=["POST"])
@require_auth
@limiter.limit(
    # Limit string is read from config at request time so that changing the
    # environment variable and restarting the app updates the limit without a
    # code change.  Flask-Limiter accepts a callable as the limit string.
    lambda: current_app.config.get("DATASET_UPLOAD_RATE_LIMIT", "10 per hour"),
    key_func=user_rate_limit_key,
)
def upload_dataset():
    """Upload and process a CSV or Excel file.

    Validation order (per Phase 2C-2 spec):
      1. Authentication — already enforced by @require_auth
      2. File present in request
      3. Filename hardening (null bytes, length, secure_filename)
      4. Extension check
      5. Dataset count quota (COUNT query, no data load)
      6. Byte-level size check (backed by MAX_CONTENT_LENGTH in Flask)
      7. Content/format validation (magic bytes / ZIP check)
      8. Parse with row limit
      9. Column count limit (enforced immediately after parse, before processing)
     10. Clean DataFrame
     11. Generate summaries
     12. Validate and sanitize metadata (name, description)
     13. Serialize and store in DB
     14. Commit and return
    """
    # ── Step 2: File present ──────────────────────────────────────────────────
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]

    # ── Step 3: Filename hardening ────────────────────────────────────────────
    raw_filename = file.filename or ""

    if not raw_filename:
        return jsonify({"error": "Empty filename"}), 400

    # Reject null bytes before any further processing.  secure_filename() strips
    # them silently; we want an explicit rejection so the client gets a clear
    # error rather than having the filename mutated without notice.
    if "\x00" in raw_filename:
        return jsonify({"error": "Invalid filename"}), 400

    # Enforce length before sanitization to avoid processing huge names.
    if len(raw_filename) > _MAX_FILENAME_LENGTH:
        return jsonify({"error": f"Filename is too long (max {_MAX_FILENAME_LENGTH} characters)"}), 400

    # Sanitize: strip path traversal components, reserved characters, etc.
    safe_name = secure_filename(raw_filename)
    if not safe_name:
        # secure_filename() returns '' for names that reduce to nothing (e.g.
        # "....." or purely non-ASCII with no safe chars).
        return jsonify({"error": "Invalid filename"}), 400

    # ── Step 4: Extension check ───────────────────────────────────────────────
    # Operate on the lowercased sanitized name so the extension logic is
    # consistent.  Note: we do NOT store safe_name as the filename yet — it is
    # used only for extension detection.  The display name is taken from
    # the user-supplied form field or the stem of safe_name.
    safe_name_lower = safe_name.lower()
    if not safe_name_lower.endswith((".csv", ".xlsx", ".xls")):
        return jsonify({"error": "Only CSV and Excel files are supported"}), 400

    # Determine the normalised extension for later branching.
    if safe_name_lower.endswith(".csv"):
        ext = ".csv"
    elif safe_name_lower.endswith(".xlsx"):
        ext = ".xlsx"
    else:
        ext = ".xls"

    # ── Step 5: Per-user dataset count quota ─────────────────────────────────
    max_datasets = current_app.config.get("MAX_DATASETS_PER_USER", 20)
    existing_count = Dataset.query.filter_by(user_id=g.current_user.id).count()
    if existing_count >= max_datasets:
        return jsonify({
            "error": f"Dataset limit reached. You can store at most {max_datasets} datasets. "
                     "Delete an existing dataset before uploading a new one."
        }), 409

    # ── Step 6: Byte-level size check ────────────────────────────────────────
    # Flask/Werkzeug enforces MAX_CONTENT_LENGTH before the handler runs.
    # We do a secondary application-level check here as belt-and-suspenders.
    max_size = current_app.config.get("MAX_UPLOAD_SIZE_MB", 16) * 1024 * 1024
    max_rows = current_app.config.get("MAX_DATASET_ROWS", 10000)
    max_cols = current_app.config.get("MAX_DATASET_COLUMNS", 500)
    max_desc_len = current_app.config.get("MAX_DATASET_DESCRIPTION_LENGTH", 1000)

    file_bytes = file.read()
    if len(file_bytes) > max_size:
        return jsonify({"error": f"File too large (max {max_size // (1024 * 1024)} MB)"}), 400

    if not file_bytes:
        return jsonify({"error": "Uploaded file is empty"}), 400

    # ── Step 7: Content / format validation ──────────────────────────────────
    content_error = _validate_content(file_bytes, ext)
    if content_error:
        return jsonify({"error": content_error}), 400

    # ── Steps 8–9: Parse + column limit ──────────────────────────────────────
    try:
        if ext == ".csv":
            df = pd.read_csv(io.BytesIO(file_bytes), nrows=max_rows)
        else:
            df = pd.read_excel(io.BytesIO(file_bytes), nrows=max_rows)

    except Exception:
        # Log full parser details server-side; return only a generic message to
        # the client so internal paths and parser internals are never exposed.
        logger.exception("Dataset parsing failed for user %s (ext=%s)", g.current_user.id, ext)
        return jsonify({
            "error": "Failed to process dataset. Please verify the file format and try again."
        }), 422

    if df.empty:
        return jsonify({"error": "File contains no data"}), 400

    # Enforce column limit immediately after parsing — before any cleaning,
    # summary generation, or JSON serialization.  Silently truncating would
    # hide the problem; we reject so the user knows to reduce column count.
    if len(df.columns) > max_cols:
        return jsonify({
            "error": f"Dataset exceeds the maximum allowed column count ({max_cols} columns)."
        }), 400

    # ── Step 10: Clean DataFrame ──────────────────────────────────────────────
    df = _clean_dataframe(df)

    # Re-check empty after cleaning (all-empty files can pass the initial check)
    if df.empty:
        return jsonify({"error": "File contains no usable data after cleaning"}), 400

    # ── Step 11: Generate summaries ───────────────────────────────────────────
    try:
        column_info = _generate_column_summary(df)
        summary = _generate_summary_stats(df, column_info)
        data_rows = _df_to_json_rows(df, max_rows)
    except Exception:
        logger.exception("Dataset profiling failed for user %s", g.current_user.id)
        return jsonify({
            "error": "Failed to process dataset. Please verify the file format and try again."
        }), 500

    # ── Step 12: Validate and sanitize metadata ───────────────────────────────
    # Dataset display name: prefer user-supplied form field, fall back to the
    # stem of the sanitized filename (never the raw user-supplied filename stem).
    name = request.form.get("name", "").strip()
    if not name:
        name = os.path.splitext(safe_name)[0]
    # Truncate name to model column limit (String(255))
    name = name[:255]

    # Description: reject over-limit values rather than silently truncating.
    description_raw = request.form.get("description", "").strip()
    if len(description_raw) > max_desc_len:
        return jsonify({
            "error": f"Dataset description is too long (max {max_desc_len} characters)."
        }), 400
    description = description_raw or None

    # ── Step 13–14: Serialize, store, commit ─────────────────────────────────
    try:
        dataset = Dataset(
            user_id=g.current_user.id,
            name=name,
            # Store the werkzeug-sanitized filename, never the raw user-supplied value.
            original_filename=safe_name,
            description=description,
            row_count=len(df),
            column_count=len(df.columns),
            columns_json=json.dumps(column_info),
            summary_json=json.dumps(summary, default=str),
            data_json=json.dumps(data_rows, default=str),
            file_size_bytes=len(file_bytes),
            upload_status="ready",
            chunks_migrated=False,   # set True below after chunks are created
        )
        db.session.add(dataset)
        db.session.flush()  # obtain dataset.id before creating chunks

        # Write all chunks in the same transaction so chunks_migrated=True is
        # only committed if every chunk INSERT succeeds.
        chunk_blobs = _build_chunks(data_rows)
        for idx, rows_json in enumerate(chunk_blobs):
            db.session.add(DatasetChunk(
                dataset_id=dataset.id,
                chunk_index=idx,
                rows_json=rows_json,
            ))
        dataset.chunks_migrated = True

        db.session.commit()
    except Exception:
        logger.exception("Dataset DB commit failed for user %s", g.current_user.id)
        db.session.rollback()
        return jsonify({
            "error": "Failed to save dataset. Please try again."
        }), 500

    return jsonify({
        "message": "Dataset uploaded and processed successfully",
        "dataset": dataset.to_dict(),
    }), 201


# ─── Read / management endpoints (unchanged) ──────────────────────────────────

@dataset_bp.route("/list", methods=["GET"])
@require_auth
def list_datasets():
    """List all datasets for the current user.

    Returns lightweight metadata only (no columns_json / summary_json blobs).
    Use GET /api/dataset/<id> to retrieve the full schema and summary for a
    specific dataset.
    """
    datasets = Dataset.query.filter_by(user_id=g.current_user.id)\
        .order_by(Dataset.created_at.desc()).all()
    return jsonify({
        "datasets": [_dataset_list_item(d) for d in datasets],
        "total": len(datasets),
    }), 200


def _dataset_list_item(d: Dataset) -> dict:
    """Return scalar-only fields for dataset list cards.

    Intentionally excludes columns_json and summary_json to avoid deserializing
    large blobs when the caller only needs the list overview.  The full schema
    and summary are available via GET /api/dataset/<id>.
    """
    return {
        "id": d.id,
        "name": d.name,
        "original_filename": d.original_filename,
        "description": d.description,
        "row_count": d.row_count,
        "column_count": d.column_count,
        "file_size_bytes": d.file_size_bytes,
        "upload_status": d.upload_status,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


@dataset_bp.route("/<int:dataset_id>", methods=["GET"])
@require_auth
def get_dataset(dataset_id):
    """Get dataset details including summary stats."""
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404
    return jsonify({"dataset": dataset.to_dict()}), 200


@dataset_bp.route("/<int:dataset_id>/data", methods=["GET"])
@require_auth
def get_dataset_data(dataset_id):
    """Get paginated dataset rows.

    For datasets with ``chunks_migrated=True`` rows are fetched by reading only
    the minimal set of ``DatasetChunk`` rows that overlap the requested page,
    avoiding a full deserialization of the entire dataset.  Legacy datasets
    (``chunks_migrated=False``) fall back to the original ``data_json`` path
    until the backfill command (``backfill_chunks.py``) has been run.
    """
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    # Clamp page to >= 1.  A client-supplied page=0 or negative value would
    # produce a negative slice start, which in Python silently returns the last
    # page_size rows — an unintended information disclosure.
    try:
        page = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1

    try:
        page_size = max(1, min(int(request.args.get("page_size", 50)), 200))
    except (TypeError, ValueError):
        page_size = 50

    total = dataset.row_count or 0
    start = (page - 1) * page_size
    end = start + page_size

    if dataset.chunks_migrated:
        page_data = _rows_from_chunks(dataset_id, start, end)
    else:
        # Legacy path: deserialize full blob and slice in Python.
        all_data = json.loads(dataset.data_json) if dataset.data_json else []
        total = len(all_data)   # authoritative for legacy datasets
        page_data = all_data[start:end]

    return jsonify({
        "data": page_data,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }), 200


def _rows_from_chunks(dataset_id: int, start: int, end: int) -> list[dict]:
    """Return rows [start, end) for a chunked dataset without loading all chunks.

    Fetches only the ``DatasetChunk`` rows whose index ranges overlap [start, end).
    For a CHUNK_SIZE=500 dataset, a typical page (50 rows) touches exactly one
    chunk; the maximum page size (200 rows) touches at most two chunks.

    Args:
        dataset_id: Primary key of the dataset.
        start:      Inclusive row offset (0-based).
        end:        Exclusive row offset.

    Returns:
        A list of row dicts.  An empty list if ``start >= total_rows``.
    """
    if start < 0 or start >= end:
        return []

    first_chunk = start // CHUNK_SIZE
    # last chunk that could contain row (end-1)
    last_chunk = (end - 1) // CHUNK_SIZE

    chunks = (
        DatasetChunk.query
        .filter(
            DatasetChunk.dataset_id == dataset_id,
            DatasetChunk.chunk_index >= first_chunk,
            DatasetChunk.chunk_index <= last_chunk,
        )
        .order_by(DatasetChunk.chunk_index)
        .all()
    )

    if not chunks:
        return []

    # Reconstruct the contiguous row list from the fetched chunks.
    all_rows: list[dict] = []
    for chunk in chunks:
        all_rows.extend(json.loads(chunk.rows_json))

    # The first row we need relative to the start of the fetched chunk window.
    local_start = start - first_chunk * CHUNK_SIZE
    local_end = local_start + (end - start)
    return all_rows[local_start:local_end]


@dataset_bp.route("/<int:dataset_id>", methods=["DELETE"])
@require_auth
def delete_dataset(dataset_id):
    """Delete a dataset and all associated chat history."""
    dataset = Dataset.query.filter_by(id=dataset_id, user_id=g.current_user.id).first()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    db.session.delete(dataset)
    db.session.commit()
    return jsonify({"message": "Dataset deleted successfully"}), 200
