"""Safe Dataset Query Engine — Phase 2C-3.

Replaces the eval()-based pandas expression execution with a constrained,
structured query DSL.

Architecture
------------

User question
    ↓
generate_structured_query() [ai_engine.py]  ← LLM produces JSON DataQuery
    ↓
validate_query()           [this module]    ← strict allowlist validator
    ↓
execute_query()            [this module]    ← deterministic pandas dispatch
    ↓
Bounded DataFrame result   (≤ MAX_RESULT_ROWS rows)

Security properties
-------------------
• No eval(), exec(), compile(), or dynamic attribute access on LLM output.
• LLM output is treated as untrusted user input throughout.
• All operation names, aggregation names, operator names, and column names
  are resolved against explicit allowlists or the actual DataFrame columns.
• Resource limits cap result rows, filter count, and value sizes.
• Prompt injection through dataset cell values cannot produce executable
  code because this layer never executes strings as Python.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

# ─── Resource limits ──────────────────────────────────────────────────────────

MAX_RESULT_ROWS: int = 50       # Maximum rows returned from any query
MAX_FILTER_COUNT: int = 10      # Maximum number of filter clauses
MAX_SORT_COLUMNS: int = 5       # Maximum columns in a sort spec
MAX_GROUP_COLUMNS: int = 3      # Maximum columns in a group-by spec
MAX_VALUE_STRING_LEN: int = 500 # Maximum character length of a filter value string
MAX_LIMIT_VALUE: int = 200      # Ceiling for any user-requested row limit

# ─── Operation allowlists ─────────────────────────────────────────────────────

ALLOWED_OPERATIONS: frozenset[str] = frozenset({
    "select",        # Return a subset of columns (optionally filtered/sorted)
    "filter",        # Filter rows by one or more conditions, return matches
    "sort",          # Sort by one or more columns
    "aggregate",     # Compute a single aggregate over a column
    "group_by",      # Group by columns, then aggregate
    "value_counts",  # Frequency count of a categorical column
    "top_n",         # Top N rows by a numeric column
    "bottom_n",      # Bottom N rows by a numeric column
    "describe",      # Statistical summary (describe) of numeric columns
    "correlation",   # Correlation matrix for numeric columns
})

ALLOWED_AGGREGATIONS: frozenset[str] = frozenset({
    "sum", "mean", "median", "min", "max", "count",
    "std", "var", "nunique", "first", "last",
})

ALLOWED_OPERATORS: frozenset[str] = frozenset({
    "eq",   # ==
    "ne",   # !=
    "lt",   # <
    "lte",  # <=
    "gt",   # >
    "gte",  # >=
    "in",   # isin([...])
    "not_in",  # ~isin([...])
    "contains",     # str.contains (case-insensitive)
    "not_contains", # ~str.contains
    "isnull",       # isna()
    "notnull",      # notna()
})

ALLOWED_SORT_DIRECTIONS: frozenset[str] = frozenset({"asc", "desc"})

# Keys allowed at top level in a DataQuery object
_QUERY_TOP_LEVEL_KEYS: frozenset[str] = frozenset({
    "operation", "columns", "filters", "sort", "limit",
    "column", "aggregation", "group_by", "n", "ascending",
})

# ─── Internal types ───────────────────────────────────────────────────────────

class QueryValidationError(ValueError):
    """Raised when a structured query fails validation."""


# ─── Validator ────────────────────────────────────────────────────────────────

def _check_str(value: Any, label: str, max_len: int = MAX_VALUE_STRING_LEN) -> str:
    """Assert that *value* is a non-empty string within *max_len* characters."""
    if not isinstance(value, str):
        raise QueryValidationError(f"{label} must be a string, got {type(value).__name__}")
    stripped = value.strip()
    if not stripped:
        raise QueryValidationError(f"{label} must not be empty")
    if len(stripped) > max_len:
        raise QueryValidationError(
            f"{label} exceeds maximum length of {max_len} characters"
        )
    return stripped


def _check_column(col: Any, df_columns: set[str], label: str = "column") -> str:
    """Assert that *col* is a known DataFrame column name."""
    name = _check_str(col, label)
    if name not in df_columns:
        raise QueryValidationError(
            f"Unknown {label} '{name}'. "
            f"Available columns: {sorted(df_columns)}"
        )
    return name


def _check_columns(cols: Any, df_columns: set[str], label: str = "columns",
                   max_count: int = MAX_SORT_COLUMNS) -> list[str]:
    """Assert that *cols* is a list of known column names within *max_count*."""
    if not isinstance(cols, list):
        raise QueryValidationError(f"{label} must be a list of column names")
    if not cols:
        raise QueryValidationError(f"{label} must not be empty")
    if len(cols) > max_count:
        raise QueryValidationError(
            f"{label} exceeds maximum of {max_count} columns"
        )
    return [_check_column(c, df_columns, label) for c in cols]


def _validate_filter(f: Any, df_columns: set[str], idx: int) -> dict:
    """Validate a single filter clause.

    Expected shape::

        {
            "column": "<known column name>",
            "operator": "<one of ALLOWED_OPERATORS>",
            "value": <string | number | list of (string | number)>  # optional for isnull/notnull
        }
    """
    label = f"filters[{idx}]"
    if not isinstance(f, dict):
        raise QueryValidationError(f"{label} must be an object")

    allowed_keys = {"column", "operator", "value"}
    unknown = set(f) - allowed_keys
    if unknown:
        raise QueryValidationError(
            f"{label} contains unexpected keys: {sorted(unknown)}"
        )

    col = _check_column(f.get("column"), df_columns, f"{label}.column")
    op_raw = f.get("operator")
    if not isinstance(op_raw, str) or op_raw.strip() not in ALLOWED_OPERATORS:
        raise QueryValidationError(
            f"{label}.operator '{op_raw}' is not allowed. "
            f"Allowed: {sorted(ALLOWED_OPERATORS)}"
        )
    op = op_raw.strip()

    # isnull / notnull do not require a value
    if op in ("isnull", "notnull"):
        return {"column": col, "operator": op}

    value = f.get("value")
    if value is None and op not in ("isnull", "notnull"):
        raise QueryValidationError(f"{label}.value is required for operator '{op}'")

    # For 'in' / 'not_in': value must be a list of scalars
    if op in ("in", "not_in"):
        if not isinstance(value, list):
            raise QueryValidationError(f"{label}.value must be a list for operator '{op}'")
        if len(value) > 50:
            raise QueryValidationError(f"{label}.value list exceeds 50 items")
        validated_list = []
        for item in value:
            if not isinstance(item, (str, int, float, bool)):
                raise QueryValidationError(
                    f"{label}.value list items must be strings or numbers"
                )
            if isinstance(item, str) and len(item) > MAX_VALUE_STRING_LEN:
                raise QueryValidationError(
                    f"{label}.value list item exceeds {MAX_VALUE_STRING_LEN} characters"
                )
            validated_list.append(item)
        return {"column": col, "operator": op, "value": validated_list}

    # For 'contains' / 'not_contains': value must be a string
    if op in ("contains", "not_contains"):
        if not isinstance(value, str):
            raise QueryValidationError(
                f"{label}.value must be a string for operator '{op}'"
            )
        _check_str(value, f"{label}.value")
        return {"column": col, "operator": op, "value": value}

    # For comparison operators: value must be a scalar
    if not isinstance(value, (str, int, float, bool)):
        raise QueryValidationError(
            f"{label}.value must be a string or number for operator '{op}'"
        )
    if isinstance(value, str) and len(value) > MAX_VALUE_STRING_LEN:
        raise QueryValidationError(
            f"{label}.value exceeds {MAX_VALUE_STRING_LEN} characters"
        )
    return {"column": col, "operator": op, "value": value}


def validate_query(raw: Any, df_columns: set[str]) -> dict:
    """Validate a raw (parsed JSON) query object and return a normalised form.

    *raw* is the output of ``json.loads()`` applied to the LLM response.
    *df_columns* is the set of column names in the actual DataFrame.

    Raises :exc:`QueryValidationError` on any violation.

    Returns a normalised dict that :func:`execute_query` can safely consume.
    """
    if not isinstance(raw, dict):
        raise QueryValidationError("Query must be a JSON object")

    # Reject unexpected top-level keys — defence against prompt injection that
    # adds extra fields hoping they will be interpreted somehow.
    unknown_keys = set(raw) - _QUERY_TOP_LEVEL_KEYS
    if unknown_keys:
        raise QueryValidationError(
            f"Query contains unexpected keys: {sorted(unknown_keys)}"
        )

    operation_raw = raw.get("operation")
    if not isinstance(operation_raw, str) or operation_raw.strip() not in ALLOWED_OPERATIONS:
        raise QueryValidationError(
            f"Unknown or missing operation '{operation_raw}'. "
            f"Allowed: {sorted(ALLOWED_OPERATIONS)}"
        )
    operation = operation_raw.strip()
    q: dict = {"operation": operation}

    # ── limit ─────────────────────────────────────────────────────────────────
    if "limit" in raw:
        limit_raw = raw["limit"]
        if not isinstance(limit_raw, int) or isinstance(limit_raw, bool):
            raise QueryValidationError("limit must be an integer")
        if limit_raw < 1:
            raise QueryValidationError("limit must be at least 1")
        q["limit"] = min(limit_raw, MAX_LIMIT_VALUE)
    else:
        q["limit"] = MAX_RESULT_ROWS

    # ── filters ───────────────────────────────────────────────────────────────
    if "filters" in raw:
        filters_raw = raw["filters"]
        if not isinstance(filters_raw, list):
            raise QueryValidationError("filters must be a list")
        if len(filters_raw) > MAX_FILTER_COUNT:
            raise QueryValidationError(
                f"filters exceeds maximum of {MAX_FILTER_COUNT} clauses"
            )
        q["filters"] = [_validate_filter(f, df_columns, i)
                        for i, f in enumerate(filters_raw)]
    else:
        q["filters"] = []

    # ── sort ──────────────────────────────────────────────────────────────────
    if "sort" in raw:
        sort_raw = raw["sort"]
        if not isinstance(sort_raw, list):
            raise QueryValidationError("sort must be a list of sort specs")
        if len(sort_raw) > MAX_SORT_COLUMNS:
            raise QueryValidationError(
                f"sort exceeds maximum of {MAX_SORT_COLUMNS} columns"
            )
        validated_sort = []
        for i, spec in enumerate(sort_raw):
            if not isinstance(spec, dict):
                raise QueryValidationError(f"sort[{i}] must be an object")
            unknown_sort_keys = set(spec) - {"column", "direction"}
            if unknown_sort_keys:
                raise QueryValidationError(
                    f"sort[{i}] contains unexpected keys: {sorted(unknown_sort_keys)}"
                )
            col = _check_column(spec.get("column"), df_columns, f"sort[{i}].column")
            direction_raw = spec.get("direction", "asc")
            if not isinstance(direction_raw, str) or direction_raw.strip() not in ALLOWED_SORT_DIRECTIONS:
                raise QueryValidationError(
                    f"sort[{i}].direction must be 'asc' or 'desc'"
                )
            validated_sort.append({"column": col, "direction": direction_raw.strip()})
        q["sort"] = validated_sort
    else:
        q["sort"] = []

    # ── operation-specific fields ─────────────────────────────────────────────
    if operation == "select":
        if "columns" in raw:
            q["columns"] = _check_columns(raw["columns"], df_columns, "columns",
                                          max_count=len(df_columns))
        else:
            q["columns"] = list(df_columns)

    elif operation in ("filter", "sort"):
        # No extra required fields beyond filters/sort
        pass

    elif operation == "aggregate":
        q["column"] = _check_column(raw.get("column"), df_columns, "column")
        agg_raw = raw.get("aggregation")
        if not isinstance(agg_raw, str) or agg_raw.strip() not in ALLOWED_AGGREGATIONS:
            raise QueryValidationError(
                f"Unknown aggregation '{agg_raw}'. "
                f"Allowed: {sorted(ALLOWED_AGGREGATIONS)}"
            )
        q["aggregation"] = agg_raw.strip()

    elif operation == "group_by":
        q["group_by"] = _check_columns(
            raw.get("group_by"), df_columns, "group_by", max_count=MAX_GROUP_COLUMNS
        )
        q["column"] = _check_column(raw.get("column"), df_columns, "column")
        agg_raw = raw.get("aggregation")
        if not isinstance(agg_raw, str) or agg_raw.strip() not in ALLOWED_AGGREGATIONS:
            raise QueryValidationError(
                f"Unknown aggregation '{agg_raw}'. "
                f"Allowed: {sorted(ALLOWED_AGGREGATIONS)}"
            )
        q["aggregation"] = agg_raw.strip()

    elif operation == "value_counts":
        q["column"] = _check_column(raw.get("column"), df_columns, "column")

    elif operation in ("top_n", "bottom_n"):
        q["column"] = _check_column(raw.get("column"), df_columns, "column")
        n_raw = raw.get("n", 10)
        if not isinstance(n_raw, int) or isinstance(n_raw, bool) or n_raw < 1:
            raise QueryValidationError("n must be a positive integer")
        q["n"] = min(n_raw, MAX_RESULT_ROWS)

    elif operation in ("describe", "correlation"):
        # Optional column subset
        if "columns" in raw:
            q["columns"] = _check_columns(raw["columns"], df_columns, "columns",
                                          max_count=len(df_columns))

    return q


# ─── Executor ─────────────────────────────────────────────────────────────────

def _apply_filters(df: pd.DataFrame, filters: list[dict]) -> pd.DataFrame:
    """Apply a validated list of filter clauses to *df*.

    Each clause was produced by :func:`_validate_filter` so all column names
    and operators are already allowlisted.  No LLM output reaches here
    as executable Python.
    """
    # Operator dispatch table — explicit callables, no string eval.
    for f in filters:
        col: str = f["column"]
        op: str = f["operator"]
        value = f.get("value")

        if col not in df.columns:
            # Column may have been dropped during cleaning; skip gracefully.
            continue

        if op == "eq":
            df = df[df[col] == value]
        elif op == "ne":
            df = df[df[col] != value]
        elif op == "lt":
            df = df[df[col] < value]
        elif op == "lte":
            df = df[df[col] <= value]
        elif op == "gt":
            df = df[df[col] > value]
        elif op == "gte":
            df = df[df[col] >= value]
        elif op == "in":
            df = df[df[col].isin(value)]
        elif op == "not_in":
            df = df[~df[col].isin(value)]
        elif op == "contains":
            df = df[df[col].astype(str).str.contains(value, case=False, na=False)]
        elif op == "not_contains":
            df = df[~df[col].astype(str).str.contains(value, case=False, na=False)]
        elif op == "isnull":
            df = df[df[col].isna()]
        elif op == "notnull":
            df = df[df[col].notna()]
        # No else: unknown ops were rejected by the validator

    return df


def _apply_sort(df: pd.DataFrame, sort_specs: list[dict]) -> pd.DataFrame:
    """Apply validated sort specs to *df*."""
    if not sort_specs:
        return df
    by = [s["column"] for s in sort_specs if s["column"] in df.columns]
    ascending = [s["direction"] == "asc" for s in sort_specs if s["column"] in df.columns]
    if not by:
        return df
    return df.sort_values(by=by, ascending=ascending)


def _df_to_result(df: pd.DataFrame, limit: int) -> pd.DataFrame:
    """Apply the final row cap and return."""
    cap = min(limit, MAX_RESULT_ROWS)
    return df.head(cap)


def execute_query(validated_q: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Execute a validated DataQuery against *df*.

    *validated_q* must have been produced by :func:`validate_query`.
    This function never evaluates strings as Python.

    Returns a DataFrame with at most MAX_RESULT_ROWS rows.
    """
    operation: str = validated_q["operation"]
    filters: list[dict] = validated_q.get("filters", [])
    sort_specs: list[dict] = validated_q.get("sort", [])
    limit: int = validated_q.get("limit", MAX_RESULT_ROWS)

    # Start with a filtered view for operations that support it.
    filtered_df = _apply_filters(df.copy(), filters) if filters else df

    # ── select ────────────────────────────────────────────────────────────────
    if operation == "select":
        cols = [c for c in validated_q.get("columns", list(df.columns)) if c in filtered_df.columns]
        result = filtered_df[cols]
        result = _apply_sort(result, sort_specs)
        return _df_to_result(result, limit)

    # ── filter ────────────────────────────────────────────────────────────────
    if operation == "filter":
        result = _apply_sort(filtered_df, sort_specs)
        return _df_to_result(result, limit)

    # ── sort ──────────────────────────────────────────────────────────────────
    if operation == "sort":
        result = _apply_sort(filtered_df, sort_specs)
        return _df_to_result(result, limit)

    # ── aggregate ─────────────────────────────────────────────────────────────
    if operation == "aggregate":
        col: str = validated_q["column"]
        agg: str = validated_q["aggregation"]
        if col not in filtered_df.columns:
            return pd.DataFrame({"result": [None]})

        # Dispatch table: explicit method calls, no dynamic getattr on LLM input.
        numeric_series = pd.to_numeric(filtered_df[col], errors="coerce").dropna()
        agg_dispatch = {
            "sum":     lambda s: s.sum(),
            "mean":    lambda s: s.mean(),
            "median":  lambda s: s.median(),
            "min":     lambda s: s.min(),
            "max":     lambda s: s.max(),
            "count":   lambda s: len(filtered_df[col].dropna()),
            "std":     lambda s: s.std(),
            "var":     lambda s: s.var(),
            "nunique": lambda _: filtered_df[col].nunique(),
            "first":   lambda _: filtered_df[col].iloc[0] if len(filtered_df) > 0 else None,
            "last":    lambda _: filtered_df[col].iloc[-1] if len(filtered_df) > 0 else None,
        }
        fn = agg_dispatch.get(agg)
        if fn is None:
            return pd.DataFrame({"result": [None]})
        value = fn(numeric_series)
        return pd.DataFrame({
            "column": [col],
            "aggregation": [agg],
            "result": [value],
        })

    # ── group_by ──────────────────────────────────────────────────────────────
    if operation == "group_by":
        group_cols = [c for c in validated_q["group_by"] if c in filtered_df.columns]
        agg_col = validated_q["column"]
        agg = validated_q["aggregation"]

        if not group_cols or agg_col not in filtered_df.columns:
            return pd.DataFrame()

        numeric = pd.to_numeric(filtered_df[agg_col], errors="coerce")
        temp_df = filtered_df[group_cols].copy()
        temp_df[f"__{agg_col}"] = numeric

        grouped = temp_df.groupby(group_cols)[f"__{agg_col}"]

        # Dispatch table
        group_dispatch = {
            "sum":     grouped.sum,
            "mean":    grouped.mean,
            "median":  grouped.median,
            "min":     grouped.min,
            "max":     grouped.max,
            "count":   grouped.count,
            "std":     grouped.std,
            "var":     grouped.var,
            "nunique": grouped.nunique,
            "first":   grouped.first,
            "last":    grouped.last,
        }
        fn = group_dispatch.get(agg)
        if fn is None:
            return pd.DataFrame()

        result = fn().reset_index()
        result = result.rename(columns={f"__{agg_col}": f"{agg_col}_{agg}"})
        result = _apply_sort(result, sort_specs)
        return _df_to_result(result, limit)

    # ── value_counts ──────────────────────────────────────────────────────────
    if operation == "value_counts":
        col = validated_q["column"]
        if col not in filtered_df.columns:
            return pd.DataFrame()
        vc = filtered_df[col].value_counts().reset_index()
        vc.columns = [col, "count"]
        return _df_to_result(vc, limit)

    # ── top_n / bottom_n ──────────────────────────────────────────────────────
    if operation in ("top_n", "bottom_n"):
        col = validated_q["column"]
        n = validated_q.get("n", 10)
        if col not in filtered_df.columns:
            return _df_to_result(filtered_df, limit)
        numeric = pd.to_numeric(filtered_df[col], errors="coerce")
        idx = numeric.nlargest(n).index if operation == "top_n" else numeric.nsmallest(n).index
        return filtered_df.loc[idx]

    # ── describe ──────────────────────────────────────────────────────────────
    if operation == "describe":
        cols = validated_q.get("columns")
        if cols:
            num_df = filtered_df[[c for c in cols if c in filtered_df.columns]]
        else:
            num_df = filtered_df.select_dtypes(include="number")
        if num_df.empty:
            return pd.DataFrame({"note": ["No numeric columns found"]})
        desc = num_df.describe().reset_index()
        desc.rename(columns={"index": "statistic"}, inplace=True)
        return desc

    # ── correlation ───────────────────────────────────────────────────────────
    if operation == "correlation":
        cols = validated_q.get("columns")
        if cols:
            num_df = filtered_df[[c for c in cols if c in filtered_df.columns]]
        else:
            num_df = filtered_df.select_dtypes(include="number")
        if num_df.empty or len(num_df.columns) < 2:
            return pd.DataFrame({"note": ["Need at least 2 numeric columns for correlation"]})
        corr = num_df.corr().reset_index()
        corr.rename(columns={"index": "column"}, inplace=True)
        return _df_to_result(corr, limit)

    # Should never reach here — validator guards operation names
    raise QueryValidationError(f"Unhandled operation: {operation!r}")


# ─── Human-readable query description ────────────────────────────────────────

def describe_query(q: dict) -> str:
    """Return a brief human-readable description of a validated DataQuery.

    This string replaces the old Python expression in API responses and stored
    ChatMessage.query_generated fields.  It contains no executable content.
    """
    op = q.get("operation", "unknown")
    parts = [f"operation: {op}"]

    if q.get("column"):
        agg = q.get("aggregation", "")
        parts.append(f"column: {q['column']}" + (f" ({agg})" if agg else ""))

    if q.get("group_by"):
        parts.append(f"group by: {', '.join(q['group_by'])}")

    if q.get("filters"):
        filt_strs = []
        for f in q["filters"]:
            val = f.get("value", "")
            filt_strs.append(f"{f['column']} {f['operator']} {val!r}")
        parts.append(f"filters: {'; '.join(filt_strs)}")

    if q.get("sort"):
        sort_strs = [f"{s['column']} {s['direction']}" for s in q["sort"]]
        parts.append(f"sort: {', '.join(sort_strs)}")

    if q.get("limit") and q["limit"] != MAX_RESULT_ROWS:
        parts.append(f"limit: {q['limit']}")

    if q.get("n"):
        parts.append(f"n: {q['n']}")

    return " | ".join(parts)
