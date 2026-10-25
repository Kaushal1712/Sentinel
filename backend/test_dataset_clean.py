"""Regression tests for dataset._clean_dataframe string trimming.
Pure pandas — no DB, Flask app context, or network."""

import datetime
import unittest

import pandas as pd

from api.dataset import _clean_dataframe


class TestCleanDataframeTrim(unittest.TestCase):
    def test_ordinary_text_is_trimmed(self):
        out = _clean_dataframe(pd.DataFrame({"t": ["  alpha ", "beta  ", " gamma"]}))
        self.assertEqual(list(out["t"]), ["alpha", "beta", "gamma"])

    def test_all_boolean_object_column_does_not_raise(self):
        df = pd.DataFrame({"b": pd.Series([True, False, True], dtype=object)})
        out = _clean_dataframe(df)
        self.assertEqual(list(out["b"]), [True, False, True])

    def test_date_object_column_preserved(self):
        dates = [datetime.date(2020, 1, 1), datetime.date(2021, 6, 30)]
        out = _clean_dataframe(pd.DataFrame({"d": pd.Series(dates, dtype=object)}))
        self.assertEqual(list(out["d"]), dates)

    def test_mixed_string_and_numeric_values_preserved(self):
        df = pd.DataFrame({
            "m": pd.Series([" a ", 5, 2.5, True, None, " b"], dtype=object),
            "k": range(6),  # keeps the row with the missing value from being dropped
        })
        out = _clean_dataframe(df)
        vals = list(out["m"])
        self.assertEqual(vals[0], "a")
        self.assertEqual(vals[1], 5)
        self.assertEqual(vals[2], 2.5)
        self.assertIs(vals[3], True)
        self.assertTrue(pd.isna(vals[4]))
        self.assertEqual(vals[5], "b")

    def test_numeric_looking_strings_still_converted(self):
        out = _clean_dataframe(pd.DataFrame({"n": pd.Series([" 1", "2 ", "3.5"], dtype=object)}))
        self.assertEqual(list(out["n"]), [1.0, 2.0, 3.5])


if __name__ == "__main__":
    unittest.main()
