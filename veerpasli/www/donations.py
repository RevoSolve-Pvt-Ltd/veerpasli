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

	context.collector = collector

	# 3. Fetch donations created by this collector
	donations = frappe.get_all(
		"Donation",
		filters={"collector": collector.name},
		fields=[
			"name",
			"takti",
			"takti_english",
			"amount_english",
			"donation_date",
			"village",
			"location"
		],
		order_by="creation desc"
	)

	# Fetch English names for village/location and donor names
	for donation in donations:
		if donation.village:
			donation.village_english = frappe.db.get_value("Village", donation.village, "english_name")
		if donation.location:
			donation.location_english = frappe.db.get_value("Location", donation.location, "location_name_english")

		# Fetch donor's actual Gujarati and English names
		donor_data = frappe.db.get_value("Person", donation.takti, ["gujarati_fullname", "english_fullname"], as_dict=True)
		if donor_data:
			donation.donor_gujarati = donor_data.gujarati_fullname
			donation.donor_english = donor_data.english_fullname
		else:
			donation.donor_gujarati = donation.takti
			donation.donor_english = donation.takti_english

	context.donations = donations
