"""Phase 2C-3 static verification tests.

Run with: python3 tests/test_query_engine_2c3.py

No Flask app, no OpenAI, no database connections required.
Tests the validator and executor directly against a small synthetic DataFrame.
"""

import json
import sys
import traceback

import pandas as pd

# ── Bootstrap path so we can import from the backend package ──────────────────
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.query_engine import (
    MAX_FILTER_COUNT,
    MAX_RESULT_ROWS,
    QueryValidationError,
    describe_query,
    execute_query,
    validate_query,
)

# ── Synthetic test DataFrame ──────────────────────────────────────────────────

DF = pd.DataFrame({
    "name":    ["Alice", "Bob", "Carol", "Dave", "Eve"],
    "dept":    ["HR", "Eng", "Eng", "HR", "Finance"],
    "salary":  [55000, 90000, 85000, 60000, 75000],
    "age":     [30, 25, 35, 40, 28],
    "active":  [True, True, False, True, False],
})
COLS = set(DF.columns)

# ─────────────────────────────────────────────────────────────────────────────
# Test infrastructure
# ─────────────────────────────────────────────────────────────────────────────

_results: list[tuple[str, bool, str]] = []


def _test(name: str, fn) -> None:
    try:
        fn()
        _results.append((name, True, ""))
        print(f"  PASS  {name}")
    except AssertionError as e:
        _results.append((name, False, str(e)))
        print(f"  FAIL  {name}: {e}")
    except Exception as e:
        tb = traceback.format_exc()
        _results.append((name, False, f"EXCEPTION: {e}\n{tb}"))
        print(f"  ERR   {name}: {e}")


def _expect_reject(raw: dict | str, label: str = "") -> None:
    """Assert that validate_query raises QueryValidationError for *raw*."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return  # Malformed JSON treated as rejected
    try:
        validate_query(raw, COLS)
        raise AssertionError(f"Expected QueryValidationError but query was accepted: {raw}")
    except QueryValidationError:
        pass  # Expected


def _expect_accept(raw: dict) -> dict:
    """Assert that validate_query returns a normalised query for *raw*."""
    return validate_query(raw, COLS)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Valid queries are accepted
# ─────────────────────────────────────────────────────────────────────────────

def t_valid_select():
    q = _expect_accept({"operation": "select", "columns": ["name", "salary"]})
    assert q["operation"] == "select"
    assert q["columns"] == ["name", "salary"]

def t_valid_filter():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "dept", "operator": "eq", "value": "Eng"}],
    })
    assert q["operation"] == "filter"
    assert len(q["filters"]) == 1

def t_valid_sort():
    q = _expect_accept({
        "operation": "sort",
        "sort": [{"column": "salary", "direction": "desc"}],
    })
    assert q["sort"][0]["direction"] == "desc"

def t_valid_aggregate():
    q = _expect_accept({
        "operation": "aggregate",
        "column": "salary",
        "aggregation": "mean",
    })
    assert q["aggregation"] == "mean"

def t_valid_group_by():
    q = _expect_accept({
        "operation": "group_by",
        "group_by": ["dept"],
        "column": "salary",
        "aggregation": "sum",
    })
    assert q["group_by"] == ["dept"]

def t_valid_value_counts():
    q = _expect_accept({"operation": "value_counts", "column": "dept"})
    assert q["column"] == "dept"

def t_valid_top_n():
    q = _expect_accept({"operation": "top_n", "column": "salary", "n": 3})
    assert q["n"] == 3

def t_valid_describe():
    q = _expect_accept({"operation": "describe"})
    assert q["operation"] == "describe"

def t_valid_correlation():
    q = _expect_accept({"operation": "correlation"})
    assert q["operation"] == "correlation"

def t_valid_in_filter():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "dept", "operator": "in", "value": ["HR", "Eng"]}],
    })
    assert q["filters"][0]["operator"] == "in"

def t_valid_isnull_filter():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "dept", "operator": "isnull"}],
    })
    assert q["filters"][0]["operator"] == "isnull"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Unknown operation is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_unknown_operation():
    _expect_reject({"operation": "exec"})

def t_unknown_operation2():
    _expect_reject({"operation": "python_eval"})

def t_missing_operation():
    _expect_reject({"filters": []})

# ─────────────────────────────────────────────────────────────────────────────
# 3. Unknown column is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_unknown_column_in_filter():
    _expect_reject({
        "operation": "filter",
        "filters": [{"column": "passwd", "operator": "eq", "value": "x"}],
    })

def t_unknown_column_aggregate():
    _expect_reject({"operation": "aggregate", "column": "nonexistent", "aggregation": "sum"})

def t_unknown_column_sort():
    _expect_reject({
        "operation": "sort",
        "sort": [{"column": "evil_col", "direction": "asc"}],
    })

# ─────────────────────────────────────────────────────────────────────────────
# 4. Unknown aggregation is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_unknown_aggregation():
    _expect_reject({
        "operation": "aggregate",
        "column": "salary",
        "aggregation": "hack",
    })

def t_aggregation_with_code():
    _expect_reject({
        "operation": "aggregate",
        "column": "salary",
        "aggregation": "__import__('os').system('id')",
    })

# ─────────────────────────────────────────────────────────────────────────────
# 5. Unknown operator is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_unknown_operator():
    _expect_reject({
        "operation": "filter",
        "filters": [{"column": "salary", "operator": "like", "value": "%"}],
    })

def t_operator_is_python():
    _expect_reject({
        "operation": "filter",
        "filters": [{"column": "salary", "operator": "eval", "value": "1"}],
    })

# ─────────────────────────────────────────────────────────────────────────────
# 6. Extra unexpected fields are rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_extra_top_level_key():
    _expect_reject({
        "operation": "select",
        "columns": ["name"],
        "evil_field": "rm -rf /",
    })

def t_extra_filter_key():
    _expect_reject({
        "operation": "filter",
        "filters": [{
            "column": "salary",
            "operator": "gt",
            "value": 50000,
            "inject": "os.system('id')",
        }],
    })

# ─────────────────────────────────────────────────────────────────────────────
# 7. Malformed JSON is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_malformed_json():
    # simulate what chat.py does when LLM returns garbage
    raw_text = "import os; os.system('id')"
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return  # Expected — malformed JSON rejected at parse stage
    _expect_reject(parsed)

def t_json_array_not_dict():
    _expect_reject([{"operation": "select"}])  # top-level must be dict

# ─────────────────────────────────────────────────────────────────────────────
# 8. Excessive result limit is capped
# ─────────────────────────────────────────────────────────────────────────────

def t_excessive_limit_capped():
    q = _expect_accept({"operation": "select", "limit": 99999})
    from core.query_engine import MAX_LIMIT_VALUE
    assert q["limit"] == MAX_LIMIT_VALUE, f"Expected {MAX_LIMIT_VALUE}, got {q['limit']}"

def t_zero_limit_rejected():
    _expect_reject({"operation": "select", "limit": 0})

def t_negative_limit_rejected():
    _expect_reject({"operation": "select", "limit": -1})

# ─────────────────────────────────────────────────────────────────────────────
# 9. Excessive filters are rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_excessive_filters():
    filters = [
        {"column": "salary", "operator": "gt", "value": i}
        for i in range(MAX_FILTER_COUNT + 1)
    ]
    _expect_reject({"operation": "filter", "filters": filters})

# ─────────────────────────────────────────────────────────────────────────────
# 10. Arbitrary Python string as operation is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_python_as_operation():
    _expect_reject({"operation": "df[df['salary']>50000]"})

def t_lambda_as_operation():
    _expect_reject({"operation": "lambda x: x"})

# ─────────────────────────────────────────────────────────────────────────────
# 11. __import__ payloads are rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_import_payload_as_operation():
    _expect_reject({"operation": "__import__('os').system('id')"})

def t_import_payload_as_column():
    _expect_reject({
        "operation": "aggregate",
        "column": "__import__('os')",
        "aggregation": "sum",
    })

def t_import_payload_as_aggregation():
    _expect_reject({
        "operation": "aggregate",
        "column": "salary",
        "aggregation": "__import__('os')",
    })

# ─────────────────────────────────────────────────────────────────────────────
# 12. lambda payload is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_lambda_as_column():
    _expect_reject({
        "operation": "aggregate",
        "column": "lambda x: x",
        "aggregation": "sum",
    })

def t_lambda_as_aggregation():
    _expect_reject({
        "operation": "aggregate",
        "column": "salary",
        "aggregation": "lambda x: x",
    })

# ─────────────────────────────────────────────────────────────────────────────
# 13. Filesystem-style payload is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_filesystem_payload_as_column():
    _expect_reject({
        "operation": "aggregate",
        "column": "/etc/passwd",
        "aggregation": "sum",
    })

def t_pd_read_csv_as_operation():
    _expect_reject({"operation": "pd.read_csv('/etc/passwd')"})

def t_pd_read_csv_as_column():
    _expect_reject({
        "operation": "value_counts",
        "column": "pd.read_csv('/etc/passwd')",
    })

# ─────────────────────────────────────────────────────────────────────────────
# 14. Attribute traversal payload is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_mro_payload_as_operation():
    _expect_reject({"operation": "().__class__.__mro__"})

def t_dunder_payload_as_column():
    _expect_reject({
        "operation": "aggregate",
        "column": "df.__class__",
        "aggregation": "sum",
    })

# ─────────────────────────────────────────────────────────────────────────────
# 15. Method-call payload is rejected
# ─────────────────────────────────────────────────────────────────────────────

def t_method_call_as_operation():
    _expect_reject({"operation": "df.apply(lambda x: os.system('id'))"})

def t_method_call_as_aggregation():
    _expect_reject({
        "operation": "aggregate",
        "column": "salary",
        "aggregation": "apply(os.system)",
    })

# ─────────────────────────────────────────────────────────────────────────────
# 16. Malicious dataset cell content cannot become executable Python
# ─────────────────────────────────────────────────────────────────────────────

def t_malicious_cell_value_in_filter_is_data_not_code():
    """A filter value containing Python code must be treated as a string comparison."""
    # The value is passed through the filter as a Python string to df[col] == value.
    # It is never eval()'d.  The validator accepts it as a valid string filter value,
    # and the executor compares it literally.
    malicious_value = "__import__('os').system('id')"
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "name", "operator": "eq", "value": malicious_value}],
    })
    # Execute — the result should be an empty DataFrame (no row has that name),
    # NOT a system call.
    result_df = execute_query(q, DF)
    assert len(result_df) == 0, "Expected 0 rows — malicious value is data, not code"
    # Verify no side-effects: the column 'name' is unchanged
    assert list(DF["name"]) == ["Alice", "Bob", "Carol", "Dave", "Eve"]

def t_malicious_column_name_rejected():
    """A filter on a non-existent 'malicious' column should be rejected."""
    _expect_reject({
        "operation": "filter",
        "filters": [{"column": "os.system('id')", "operator": "eq", "value": "x"}],
    })

# ─────────────────────────────────────────────────────────────────────────────
# 17. Safe filtering works correctly
# ─────────────────────────────────────────────────────────────────────────────

def t_filter_eq_returns_correct_rows():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "dept", "operator": "eq", "value": "Eng"}],
    })
    result = execute_query(q, DF)
    assert list(result["name"]) == ["Bob", "Carol"]

def t_filter_gt_returns_correct_rows():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "salary", "operator": "gt", "value": 80000}],
    })
    result = execute_query(q, DF)
    assert len(result) == 2
    assert set(result["name"]) == {"Bob", "Carol"}

def t_filter_in_operator():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "dept", "operator": "in", "value": ["HR", "Finance"]}],
    })
    result = execute_query(q, DF)
    assert set(result["dept"].unique()) <= {"HR", "Finance"}

def t_filter_contains_operator():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "name", "operator": "contains", "value": "a"}],
    })
    result = execute_query(q, DF)
    assert all("a" in n.lower() for n in result["name"])

# ─────────────────────────────────────────────────────────────────────────────
# 18. Safe aggregation works correctly
# ─────────────────────────────────────────────────────────────────────────────

def t_aggregate_mean():
    q = _expect_accept({"operation": "aggregate", "column": "salary", "aggregation": "mean"})
    result = execute_query(q, DF)
    expected = DF["salary"].mean()
    assert abs(float(result["result"].iloc[0]) - expected) < 0.01

def t_aggregate_sum():
    q = _expect_accept({"operation": "aggregate", "column": "salary", "aggregation": "sum"})
    result = execute_query(q, DF)
    assert float(result["result"].iloc[0]) == DF["salary"].sum()

def t_aggregate_count():
    q = _expect_accept({"operation": "aggregate", "column": "salary", "aggregation": "count"})
    result = execute_query(q, DF)
    assert int(result["result"].iloc[0]) == 5

def t_aggregate_min_max():
    for agg, expected in [("min", 55000), ("max", 90000)]:
        q = _expect_accept({"operation": "aggregate", "column": "salary", "aggregation": agg})
        result = execute_query(q, DF)
        assert float(result["result"].iloc[0]) == expected, f"Failed for agg={agg}"

# ─────────────────────────────────────────────────────────────────────────────
# 19. Safe group-by works correctly
# ─────────────────────────────────────────────────────────────────────────────

def t_group_by_sum():
    q = _expect_accept({
        "operation": "group_by",
        "group_by": ["dept"],
        "column": "salary",
        "aggregation": "sum",
    })
    result = execute_query(q, DF)
    assert "dept" in result.columns
    assert "salary_sum" in result.columns
    eng_row = result[result["dept"] == "Eng"]
    assert float(eng_row["salary_sum"].iloc[0]) == 175000

def t_group_by_count():
    q = _expect_accept({
        "operation": "group_by",
        "group_by": ["dept"],
        "column": "salary",
        "aggregation": "count",
    })
    result = execute_query(q, DF)
    assert len(result) == 3  # HR, Eng, Finance

# ─────────────────────────────────────────────────────────────────────────────
# 20. Result size remains bounded
# ─────────────────────────────────────────────────────────────────────────────

def t_result_size_bounded_by_max():
    # Create a large DataFrame
    large_df = pd.DataFrame({"x": range(10000), "y": range(10000)})
    large_cols = set(large_df.columns)
    q = validate_query({"operation": "select", "limit": 99999}, large_cols)
    result = execute_query(q, large_df)
    assert len(result) <= MAX_RESULT_ROWS, f"Result has {len(result)} rows, expected <= {MAX_RESULT_ROWS}"

def t_top_n_bounded():
    q = _expect_accept({"operation": "top_n", "column": "salary", "n": 99999})
    assert q["n"] <= MAX_RESULT_ROWS

# ─────────────────────────────────────────────────────────────────────────────
# 21. Natural-language insight flow contract (code-level check)
# ─────────────────────────────────────────────────────────────────────────────

def t_generate_insight_still_importable():
    """generate_insight must still exist in ai_engine and have the correct signature."""
    from core.ai_engine import generate_insight, suggest_chart
    import inspect
    sig_insight = inspect.signature(generate_insight)
    params = list(sig_insight.parameters)
    assert "user_question" in params
    assert "data" in params
    assert "columns" in params

def t_generate_structured_query_exists():
    """generate_structured_query must exist and replace generate_data_query."""
    from core.ai_engine import generate_structured_query
    import inspect
    sig = inspect.signature(generate_structured_query)
    params = list(sig.parameters)
    assert "user_message" in params
    assert "schema" in params
    assert "sample_data" in params

def t_generate_data_query_removed():
    """generate_data_query (the old Python-expression generator) must be gone."""
    import core.ai_engine as engine
    assert not hasattr(engine, "generate_data_query"), (
        "generate_data_query still exists in ai_engine — the old eval-based path is not fully removed"
    )

def t_eval_not_in_chat_module():
    """chat.py must not contain eval() calls."""
    import ast
    with open(os.path.join(os.path.dirname(__file__), "..", "api", "chat.py")) as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id == "eval":
                raise AssertionError("eval() call found in chat.py")
            if isinstance(func, ast.Name) and func.id == "exec":
                raise AssertionError("exec() call found in chat.py")

def t_eval_not_in_query_engine():
    """query_engine.py must not contain eval() or exec()."""
    import ast
    qe_path = os.path.join(os.path.dirname(__file__), "..", "core", "query_engine.py")
    with open(qe_path) as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in ("eval", "exec", "compile"):
                raise AssertionError(f"{func.id}() call found in query_engine.py")

def t_describe_query_returns_string():
    q = _expect_accept({
        "operation": "group_by",
        "group_by": ["dept"],
        "column": "salary",
        "aggregation": "mean",
        "filters": [{"column": "active", "operator": "eq", "value": True}],
    })
    desc = describe_query(q)
    assert isinstance(desc, str)
    assert "group_by" in desc
    assert "salary" in desc

# ─────────────────────────────────────────────────────────────────────────────
# 22. Additional edge cases
# ─────────────────────────────────────────────────────────────────────────────

def t_sort_desc_works():
    q = _expect_accept({
        "operation": "sort",
        "sort": [{"column": "salary", "direction": "desc"}],
        "limit": 3,
    })
    result = execute_query(q, DF)
    salaries = list(result["salary"])
    assert salaries == sorted(salaries, reverse=True)[:3]

def t_value_counts_correct():
    q = _expect_accept({"operation": "value_counts", "column": "dept"})
    result = execute_query(q, DF)
    assert "dept" in result.columns
    assert "count" in result.columns
    eng_row = result[result["dept"] == "Eng"]
    assert int(eng_row["count"].iloc[0]) == 2

def t_bottom_n_works():
    q = _expect_accept({"operation": "bottom_n", "column": "salary", "n": 2})
    result = execute_query(q, DF)
    assert set(result["name"]) == {"Alice", "Dave"}

def t_filter_notnull_works():
    q = _expect_accept({
        "operation": "filter",
        "filters": [{"column": "name", "operator": "notnull"}],
    })
    result = execute_query(q, DF)
    assert len(result) == 5  # all rows have a name


# ─────────────────────────────────────────────────────────────────────────────
# Run all tests
# ─────────────────────────────────────────────────────────────────────────────

ALL_TESTS = [
    # 1. Valid queries
    t_valid_select, t_valid_filter, t_valid_sort, t_valid_aggregate,
    t_valid_group_by, t_valid_value_counts, t_valid_top_n, t_valid_describe,
    t_valid_correlation, t_valid_in_filter, t_valid_isnull_filter,
    # 2. Unknown operation
    t_unknown_operation, t_unknown_operation2, t_missing_operation,
    # 3. Unknown column
    t_unknown_column_in_filter, t_unknown_column_aggregate, t_unknown_column_sort,
    # 4. Unknown aggregation
    t_unknown_aggregation, t_aggregation_with_code,
    # 5. Unknown operator
    t_unknown_operator, t_operator_is_python,
    # 6. Extra fields
    t_extra_top_level_key, t_extra_filter_key,
    # 7. Malformed JSON
    t_malformed_json, t_json_array_not_dict,
    # 8. Limit capping
    t_excessive_limit_capped, t_zero_limit_rejected, t_negative_limit_rejected,
    # 9. Excessive filters
    t_excessive_filters,
    # 10. Arbitrary Python
    t_python_as_operation, t_lambda_as_operation,
    # 11. __import__
    t_import_payload_as_operation, t_import_payload_as_column, t_import_payload_as_aggregation,
    # 12. lambda
    t_lambda_as_column, t_lambda_as_aggregation,
    # 13. Filesystem
    t_filesystem_payload_as_column, t_pd_read_csv_as_operation, t_pd_read_csv_as_column,
    # 14. Attribute traversal
    t_mro_payload_as_operation, t_dunder_payload_as_column,
    # 15. Method calls
    t_method_call_as_operation, t_method_call_as_aggregation,
    # 16. Malicious cell content
    t_malicious_cell_value_in_filter_is_data_not_code, t_malicious_column_name_rejected,
    # 17. Safe filtering
    t_filter_eq_returns_correct_rows, t_filter_gt_returns_correct_rows,
    t_filter_in_operator, t_filter_contains_operator,
    # 18. Safe aggregation
    t_aggregate_mean, t_aggregate_sum, t_aggregate_count, t_aggregate_min_max,
    # 19. Safe group-by
    t_group_by_sum, t_group_by_count,
    # 20. Result size
    t_result_size_bounded_by_max, t_top_n_bounded,
    # 21. Code-level contract
    t_generate_insight_still_importable, t_generate_structured_query_exists,
    t_generate_data_query_removed, t_eval_not_in_chat_module,
    t_eval_not_in_query_engine, t_describe_query_returns_string,
    # 22. Edge cases
    t_sort_desc_works, t_value_counts_correct, t_bottom_n_works, t_filter_notnull_works,
]


if __name__ == "__main__":
    print(f"\nPhase 2C-3 Static Verification — {len(ALL_TESTS)} test cases\n")
    for test_fn in ALL_TESTS:
        _test(test_fn.__name__, test_fn)

    passed = sum(1 for _, ok, _ in _results if ok)
    failed = len(_results) - passed
    print(f"\n{'='*60}")
    print(f"Results: {passed}/{len(_results)} passed, {failed} failed")

    if failed:
        print("\nFailed tests:")
        for name, ok, msg in _results:
            if not ok:
                print(f"  - {name}: {msg[:300]}")
        sys.exit(1)
    else:
        print("\nAll tests PASSED. eval() path eliminated. Safe DSL operational.")
        sys.exit(0)
