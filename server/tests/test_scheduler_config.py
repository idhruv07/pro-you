"""
test_scheduler_config.py
------------------------
WHITE BOX unit tests for the ReadBudget class in scheduler_config.py.
Tests budget initialization, charge tracking, BudgetExceeded exception,
and edge cases at the exact limit boundary.

Run: pytest tests/test_scheduler_config.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from scheduler_config import ReadBudget, READ_BUDGET_PER_RUN


class TestReadBudgetInit:
    """Tests for ReadBudget initial state."""

    def test_budget_starts_at_zero(self):
        """Budget used should be 0 immediately after creation."""
        budget = ReadBudget(1000)
        assert budget.used == 0

    def test_budget_limit_stored_correctly(self):
        """Limit set in constructor should be accessible."""
        budget = ReadBudget(5000)
        assert budget.limit == 5000

    def test_default_budget_constant_is_sensible(self):
        """READ_BUDGET_PER_RUN should be > 0 and <= 50000 (Firestore free tier)."""
        assert 0 < READ_BUDGET_PER_RUN <= 50000


class TestReadBudgetCharge:
    """Tests for ReadBudget.charge() method."""

    def test_single_charge_within_limit(self):
        """A single charge under limit increments used correctly."""
        budget = ReadBudget(1000)
        budget.charge(100, "test read")
        assert budget.used == 100

    def test_multiple_charges_accumulate(self):
        """Multiple charges sum up correctly."""
        budget = ReadBudget(1000)
        budget.charge(100, "first")
        budget.charge(200, "second")
        budget.charge(50, "third")
        assert budget.used == 350

    def test_charge_exactly_at_limit_is_allowed(self):
        """A charge that brings used to exactly the limit should succeed."""
        budget = ReadBudget(500)
        budget.charge(500, "exact limit")
        assert budget.used == 500

    def test_charge_zero_is_allowed(self):
        """Charging 0 reads should not raise and should not increment used."""
        budget = ReadBudget(1000)
        budget.charge(0, "zero charge")
        assert budget.used == 0


class TestReadBudgetExceeded:
    """Tests for BudgetExceeded exception."""

    def test_charge_over_limit_raises(self):
        """A charge exceeding the limit must raise BudgetExceeded."""
        budget = ReadBudget(100)
        with pytest.raises(ReadBudget.BudgetExceeded):
            budget.charge(101, "over limit")

    def test_used_not_incremented_after_raise(self):
        """After BudgetExceeded is raised, used should remain unchanged."""
        budget = ReadBudget(100)
        budget.charge(50, "first half")
        try:
            budget.charge(100, "over limit")
        except ReadBudget.BudgetExceeded:
            pass
        assert budget.used == 50

    def test_second_charge_cumulative_raises(self):
        """Two charges that together exceed limit should raise on the second."""
        budget = ReadBudget(200)
        budget.charge(150, "first")
        with pytest.raises(ReadBudget.BudgetExceeded):
            budget.charge(100, "second — exceeds combined")

    def test_budget_exceeded_is_exception(self):
        """BudgetExceeded should be a subclass of Exception."""
        assert issubclass(ReadBudget.BudgetExceeded, Exception)

    def test_budget_exceeded_message_contains_label(self):
        """BudgetExceeded message should include the label for debugging."""
        budget = ReadBudget(100)
        with pytest.raises(ReadBudget.BudgetExceeded) as exc_info:
            budget.charge(200, "my_query_label")
        assert "my_query_label" in str(exc_info.value)
