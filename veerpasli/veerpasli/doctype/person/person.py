# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Person(Document):
	def validate(self):
		if self.is_collector == "true":
			if not self.collector_locations:
				frappe.throw("Collector Locations is mandatory for a Collector.")
		else:
			self.set("collector_locations", [])
