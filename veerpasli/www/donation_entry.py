import frappe
import json
from frappe import _
from veerpasli.veerpasli.doctype.pdf_page.pdf_page import (
	get_or_create_village,
	get_translated_names,
	get_or_create_person,
	distribute_amount_equally
)

def get_context(context):
	# 1. Require Login
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_to = "/login?redirect-to=/donation_entry"
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

	context.collector = collector

	# 3. Load villages and locations for dropdown/autofill
	context.villages = frappe.get_all(
		"Village",
		fields=["name", "english_name"],
		order_by="name asc"
	)
	context.locations = frappe.get_all(
		"Location",
		fields=["name", "location_name_english"],
		order_by="name asc"
	)


@frappe.whitelist()
def search_donor(query):
	"""
	Search existing non-collector Person records by name or mobile number.
	"""
	if not query:
		return []

	# Try exact/like search by mobile
	donors = frappe.get_all(
		"Person",
		filters=[
			["mobile_number", "like", f"%{query}%"],
			["is_collector", "=", "false"]
		],
		fields=["name", "gujarati_fullname", "english_fullname", "mobile_number", "village_gujarati_name"]
	)

	if not donors:
		# Try Gujarati name search
		donors = frappe.get_all(
			"Person",
			filters=[
				["is_collector", "=", "false"],
				["gujarati_fullname", "like", f"%{query}%"]
			],
			fields=["name", "gujarati_fullname", "english_fullname", "mobile_number", "village_gujarati_name"],
			limit=10
		)

	if not donors:
		# Try English name search
		donors = frappe.get_all(
			"Person",
			filters=[
				["is_collector", "=", "false"],
				["english_fullname", "like", f"%{query}%"]
			],
			fields=["name", "gujarati_fullname", "english_fullname", "mobile_number", "village_gujarati_name"],
			limit=10
		)

	# Fetch Village details for each donor
	for d in donors:
		if d.village_gujarati_name:
			d.village_english = frappe.db.get_value("Village", d.village_gujarati_name, "english_name")
		else:
			d.village_english = ""

	return donors


@frappe.whitelist()
def create_web_donation(donor_data, amount, village, location, donation_date=None, hastes=None):
	"""
	Create a Donation document from the web form submission.
	donor_data should be a JSON/dict containing:
	- name (if existing Person)
	- gujarati_fullname
	- english_fullname
	- mobile_number
	"""
	# 1. Verification
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to submit a donation."), frappe.PermissionError)

	collector = frappe.db.get_value(
		"Person",
		{"user": frappe.session.user, "is_collector": "true"},
		"name"
	)
	if not collector:
		frappe.throw(_("Only registered collectors can submit donations."), frappe.PermissionError)

	if isinstance(donor_data, str):
		donor_data = json.loads(donor_data)

	if isinstance(hastes, str):
		hastes = json.loads(hastes)
	elif not hastes:
		hastes = []

	amount = int(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than zero."))

	if not location:
		frappe.throw(_("Location is required."))

	# 2. Get or Create Donor Person
	donor_name = donor_data.get("name")
	if donor_name and frappe.db.exists("Person", donor_name):
		# Existing Person
		donor_doc = frappe.get_doc("Person", donor_name)
		# Update mobile if provided and empty
		if donor_data.get("mobile_number") and not donor_doc.mobile_number:
			donor_doc.mobile_number = donor_data.get("mobile_number")
			donor_doc.save(ignore_permissions=True)
	else:
		# Create New Person
		guj_name = donor_data.get("gujarati_fullname", "").strip()
		eng_name = donor_data.get("english_fullname", "").strip()
		mobile = donor_data.get("mobile_number", "").strip()

		if not guj_name and not eng_name:
			frappe.throw(_("Donor name (Gujarati or English) is required."))

		# Auto-translate if one of them is missing
		if not guj_name:
			guj_name, _ = get_translated_names(eng_name)
		elif not eng_name:
			_, eng_name = get_translated_names(guj_name)

		# Ensure we have a village
		if not village:
			frappe.throw(_("Village is required to register a new donor."))

		village_doc = get_or_create_village(village)

		# Create new Person document
		new_person = frappe.get_doc({
			"doctype": "Person",
			"gujarati_fullname": guj_name,
			"english_fullname": eng_name,
			"mobile_number": mobile,
			"village_gujarati_name": village_doc.name,
			"is_collector": "false"
		})
		new_person.insert(ignore_permissions=True)
		donor_name = new_person.name

	# 3. Ensure Village exists
	if village:
		village_doc = get_or_create_village(village)
		village_link = village_doc.name
	else:
		village_doc = None
		village_link = None

	# 4. Create and Submit Donation
	# Render Gujarati numbers for amount
	amount_str = str(amount)
	# Dictionary mapping english numbers to gujarati numbers
	num_map = {'0':'૦', '1':'૧', '2':'૨', '3':'૩', '4':'૪', '5':'૫', '6':'૬', '7':'૭', '8':'૮', '9':'૯'}
	amount_guj = "".join(num_map.get(char, char) for char in amount_str)

	donation = frappe.get_doc({
		"doctype": "Donation",
		"takti": donor_name,
		"amount_gujarati": amount_guj,
		"amount_english": amount,
		"donation_date": donation_date or frappe.utils.today(),
		"village": village_link,
		"location": location,
		"collector": collector,
		"list_of_donors": []
	})

	# Clean and filter haste names
	haste_names = [h.strip() for h in hastes if h and h.strip()]

	if not haste_names:
		donation.append("list_of_donors", {
			"donor_name": donor_name,
			"amount": amount
		})
	else:
		if not village_doc:
			frappe.throw(_("Village is required to register haste names."))
		
		distributed_amounts = distribute_amount_equally(amount, len(haste_names))
		for idx, haste_name in enumerate(haste_names):
			haste_person = get_or_create_person(haste_name, village_doc, '', is_collector=False)
			donation.append("list_of_donors", {
				"donor_name": haste_person.name,
				"amount": distributed_amounts[idx]
			})
	
	donation.insert(ignore_permissions=True)
	donation.submit()

	return {
		"status": "success",
		"donation_id": donation.name,
		"donor_name": donation.takti_english or donation.takti
	}
