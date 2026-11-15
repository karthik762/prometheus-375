"""
Regression tests for get_preset_onset_shift() function.

Tests the function's behavior with various mocked Parquet query results,
ensuring both onset_shift_days and onset_shift_min_days are handled independently.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '.'))

import unittest
from unittest.mock import patch, MagicMock
import numpy as np

from anomaly import get_preset_onset_shift


class TestGetPresetOnsetShift(unittest.TestCase):
    """Test cases for get_preset_onset_shift function."""

    def setUp(self):
        """Set up test fixtures."""
        # We'll mock the entire function's dependencies
        pass

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_both_values_valid(self, mock_find, mock_connect):
        """Test when both onset_shift_days and onset_shift_min_days are valid."""
        # Setup mock
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (11.0, 28.5)  # (shift, min_shift)
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        # Call function
        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        # Assert both values returned correctly
        self.assertEqual(result, (11.0, 28.5))
        mock_find.assert_called_once_with("onset", region="brazil")
        mock_con.execute.assert_called_once()

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_only_shift_valid(self, mock_find, mock_connect):
        """Test when only onset_shift_days is valid, min_shift is None."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (11.0, None)
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2026)

        self.assertEqual(result, (11.0, None))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_only_min_shift_valid(self, mock_find, mock_connect):
        """Test when only onset_shift_min_days is valid, shift is None."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (None, 28.5)
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_india.parquet"

        result = get_preset_onset_shift(region='india', area_id='pb_hr', year=2026)

        self.assertEqual(result, (None, 28.5))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_both_none(self, mock_find, mock_connect):
        """Test when both values are None."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (None, None)
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        self.assertEqual(result, (None, None))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_shift_nan(self, mock_find, mock_connect):
        """Test when shift is NaN."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (float('nan'), 28.5)
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        # NaN should be treated as invalid, min_shift should be returned
        self.assertEqual(result, (None, 28.5))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_min_shift_nan(self, mock_find, mock_connect):
        """Test when min_shift is NaN."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (11.0, float('nan'))
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        # NaN should be treated as invalid, shift should be returned
        self.assertEqual(result, (11.0, None))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_both_nan(self, mock_find, mock_connect):
        """Test when both values are NaN."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_res = (float('nan'), float('nan'))
        mock_con.execute.return_value.fetchone.return_value = mock_res
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        self.assertEqual(result, (None, None))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_no_result_from_query(self, mock_find, mock_connect):
        """Test when query returns no rows."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_con.execute.return_value.fetchone.return_value = None
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        self.assertEqual(result, (None, None))

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_no_onset_file(self, mock_find, mock_connect):
        """Test when no onset file is found."""
        mock_find.return_value = None

        result = get_preset_onset_shift(region='unknown', area_id='unknown', year=2024)

        self.assertEqual(result, (None, None))
        mock_connect.assert_not_called()

    @patch('anomaly.duckdb.connect')
    @patch('anomaly.find_precomputed_file')
    def test_database_exception(self, mock_find, mock_connect):
        """Test when database raises an exception."""
        mock_con = MagicMock()
        mock_connect.return_value = mock_con
        mock_con.execute.side_effect = Exception("Database error")
        mock_find.return_value = "/fake/path/onset_brazil.parquet"

        result = get_preset_onset_shift(region='brazil', area_id='brazil', year=2024)

        self.assertEqual(result, (None, None))


if __name__ == '__main__':
    unittest.main()