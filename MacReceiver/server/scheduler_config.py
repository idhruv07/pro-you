"""
Scheduler Configuration & Budget Module
----------------------------------------
This module handles budget limits, Firestore read tracking (ReadBudget), 
and general utility tasks like logging budget alerts to Firestore.
"""

import datetime
import logging

logger = logging.getLogger(__name__)

READ_BUDGET_PER_RUN = 10_000

class ReadBudget:
    """
    Hard Firestore read counter. Call .charge(n, label) before every query.
    Raises BudgetExceeded if the query would push reads over the limit.
    """

    class BudgetExceeded(Exception):
        pass

    def __init__(self, limit: int):
        self.limit = limit
        self._used = 0

    @property
    def used(self):
        return self._used

    def charge(self, estimated_reads: int, label: str = ""):
        """Raises BudgetExceeded if adding estimated_reads would exceed the limit."""
        if self._used + estimated_reads > self.limit:
            raise ReadBudget.BudgetExceeded(
                f"Budget exceeded: used={self._used}, cost={estimated_reads}, "
                f"limit={self.limit} [{label}]"
            )
        self._used += estimated_reads
        logger.info(f"ReadBudget +{estimated_reads} ({label}) = {self._used}/{self.limit}")


def _save_budget_alert(db, job_name: str, reads_used: int, message: str):
    """Writes a quota alert to Firestore alerts collection for dashboard display."""
    try:
        db.collection("alerts").add({
            "type": "quota_warning",
            "job": job_name,
            "reads_used": reads_used,
            "budget_limit": READ_BUDGET_PER_RUN,
            "message": message,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "resolved": False,
        })
    except Exception as e:
        logger.error(f"Failed to save budget alert: {e}")
