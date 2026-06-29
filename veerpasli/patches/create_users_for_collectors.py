import frappe
from veerpasli.veerpasli.doctype.person.person import create_user_for_collector

def execute():
	"""
	Loop through all existing Person records where is_collector is 'true' or '1',
	migrate database values, and trigger user creation/linking logic directly.
	"""
	# 1. Normalize database values: migrate '1'/'0' to 'true'/'false'
	frappe.db.sql("update `tabPerson` set is_collector = 'true' where is_collector = '1'")
	frappe.db.sql("update `tabPerson` set is_collector = 'false' where is_collector = '0'")
	frappe.db.commit()

	# 2. Get all collectors
	collectors = frappe.get_all(
		"Person",
		filters={"is_collector": "true"},
		fields=["name"]
	)

	patched_count = 0
	for c in collectors:
		try:
			doc = frappe.get_doc("Person", c.name)
			
			# Directly run user creation logic to bypass missing locations validations
			create_user_for_collector(doc)
			if doc.user:
				doc.db_set("user", doc.user)
				patched_count += 1
		except Exception as e:
			frappe.log_error(
				title="create_users_for_collectors patch failed",
				message=f"Failed for Person {c.name}: {str(e)}"
			)

	frappe.db.commit()
	print(f"Patched: Processed {patched_count} collectors for user creation.")
