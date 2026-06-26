# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
import json
from frappe.model.document import Document
from frappe.utils import getdate
from frappe.model.naming import make_autoname


class Donation(Document):
	def autoname(self):
		# Extract year from the donation date, or default to current calendar year
		year = getdate(self.donation_date).year if self.donation_date else getdate().year
		
		# 1. Generate name with a unique prefix to avoid any Series key collision in tabSeries
		unique_prefix = f"VEER-DON-{year}-"
		generated_name = make_autoname(f"{unique_prefix}.#######")
		
		# 2. Format name to return to the clean "YYYY-000000X" layout
		self.name = generated_name.replace(unique_prefix, f"{year}-")


@frappe.whitelist()
def get_donation_total(filters=None):
	"""Return the SUM and COUNT of amount_english for the given filters.
	Called by the Donation List View to display a live total in the footer.
	"""
	if filters and isinstance(filters, str):
		filters = json.loads(filters)

	records = frappe.get_all(
		"Donation",
		filters=filters or [],
		fields=["amount_english"],
		limit=0,        # fetch ALL matching records
	)

	total = sum((r.amount_english or 0) for r in records)
	return {"total": total, "count": len(records)}
