import frappe
from frappe import _

def get_context(context):
	# 1. Require Login
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_to = "/login?redirect-to=/donations"
		raise frappe.Redirect

	# 2. Check if logged-in user is linked to a Collector Person record
	collector = frappe.db.get_value(
		"Person",
		{"user": frappe.session.user, "is_collector": "true"},
		["name", "gujarati_fullname", "english_fullname"],
		as_dict=True
	)

	if not collector:
		context.unauthorized = True
		return

	donation_id = frappe.form_dict.get("name")
	if not donation_id:
		context.error = _("No donation ID provided.")
		return

	if not frappe.db.exists("Donation", donation_id):
		context.error = _("Donation record not found.")
		return

	donation_doc = frappe.get_doc("Donation", donation_id)

	context.donation = donation_doc

	# Fetch English names for village/location
	if donation_doc.village:
		context.village_english = frappe.db.get_value("Village", donation_doc.village, "english_name")
	if donation_doc.location:
		context.location_english = frappe.db.get_value("Location", donation_doc.location, "location_name_english")

	# Fetch takti Person details
	takti_data = frappe.db.get_value("Person", donation_doc.takti, ["gujarati_fullname", "english_fullname"], as_dict=True)
	context.takti_gujarati = takti_data.gujarati_fullname if takti_data else donation_doc.takti
	context.takti_english = takti_data.english_fullname if takti_data else donation_doc.takti_english

	# Fetch collector Person details
	collector_data = frappe.db.get_value("Person", donation_doc.collector, ["gujarati_fullname", "english_fullname"], as_dict=True)
	context.collector_name_guj = collector_data.gujarati_fullname if collector_data else donation_doc.collector
	context.collector_name_eng = collector_data.english_fullname if collector_data else ""

	# Fetch donors list (hastes breakdown)
	donors_list = []
	for d in donation_doc.list_of_donors:
		person_data = frappe.db.get_value("Person", d.donor_name, ["gujarati_fullname", "english_fullname"], as_dict=True)
		donors_list.append({
			"name": d.donor_name,
			"gujarati_fullname": person_data.gujarati_fullname if person_data else d.donor_name,
			"english_fullname": person_data.english_fullname if person_data else "",
			"amount": d.amount
		})
	context.donors_list = donors_list
