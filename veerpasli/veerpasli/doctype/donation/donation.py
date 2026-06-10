# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
import json
from frappe.model.document import Document


class Donation(Document):
	pass


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
