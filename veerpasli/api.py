import json
import base64
import requests
import frappe
from frappe import _
from frappe.utils.pdf import get_pdf
from veerpasli.veerpasli.doctype.pdf_page.pdf_page import (
	get_or_create_village,
	get_translated_names,
	get_or_create_person,
	distribute_amount_equally
)

# ---------------------------------------------------------------------------
# Internal Helpers
# ---------------------------------------------------------------------------

def _get_collector_profile(user_email):
	"""Return the Person doc linked to this user, asserting they are a collector."""
	person = frappe.db.get_value(
		"Person",
		{"user": user_email, "is_collector": "true"},
		["name", "gujarati_fullname", "english_fullname", "mobile_number",
		 "village_gujarati_name", "village_english_name", "profile"],
		as_dict=True,
	)
	if not person:
		frappe.throw(_("This user is not registered as a Collector."), frappe.PermissionError)
	return person

def _generate_keys(user_email):
	"""Generate (or regenerate) api_key + api_secret for the given user."""
	user_doc = frappe.get_doc("User", user_email)

	if not user_doc.api_key:
		api_key = frappe.generate_hash(length=15)
		user_doc.api_key = api_key

	api_secret = frappe.generate_hash(length=15)
	user_doc.api_secret = api_secret
	user_doc.save(ignore_permissions=True)
	frappe.db.commit()
	return user_doc.api_key, api_secret

def _get_collector_locations(collector_name):
	"""Return list of locations assigned to the collector."""
	assigned = frappe.get_all(
		"Collector Location",
		filters={"parent": collector_name, "parenttype": "Person"},
		fields=["location"],
		order_by="idx asc",
	)
	if not assigned:
		return []

	location_names = [row["location"] for row in assigned]
	return frappe.get_all(
		"Location",
		filters={"name": ["in", location_names]},
		fields=["name", "location_name", "location_name_english"],
		order_by="location_name asc",
	)

# ---------------------------------------------------------------------------
# Authentication Endpoints (for Mobile / Token clients)
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def login(usr, pwd):
	"""Authenticate with credentials and return API key, secret, and collector profile."""
	from frappe.auth import LoginManager
	login_manager = LoginManager()
	login_manager.authenticate(user=usr, pwd=pwd)
	login_manager.post_login()

	user_email = frappe.session.user
	if not user_email or user_email == "Guest":
		frappe.throw(_("Invalid credentials"), frappe.AuthenticationError)

	collector = _get_collector_profile(user_email)
	api_key, api_secret = _generate_keys(user_email)
	locations = _get_collector_locations(collector["name"])

	return {
		"message": "Logged in successfully",
		"api_key": api_key,
		"api_secret": api_secret,
		"collector": {
			"name": collector["name"],
			"gujarati_fullname": collector["gujarati_fullname"],
			"english_fullname": collector["english_fullname"],
			"mobile_number": collector["mobile_number"],
			"village": collector["village_gujarati_name"],
			"village_english": collector["village_english_name"],
			"profile_image": collector["profile"],
			"locations": locations,
		},
	}

@frappe.whitelist()
def logout():
	"""Revoke API keys and log out current session."""
	user_email = frappe.session.user
	if not user_email or user_email == "Guest":
		frappe.throw(_("Not authenticated"), frappe.AuthenticationError)

	user_doc = frappe.get_doc("User", user_email)
	user_doc.api_key = ""
	user_doc.api_secret = ""
	user_doc.save(ignore_permissions=True)
	frappe.db.commit()

	frappe.local.login_manager.logout()

	return {"message": "Logged out successfully"}

# ---------------------------------------------------------------------------
# Core Unified Endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_donations(page=None, page_size=None, location=None, start_date=None, end_date=None, search=None):
	"""
	Unified dashboard and list endpoint.
	If page/page_size are passed, it returns a paginated list (for mobile).
	If not passed, it returns the complete list of donations (for SPA/Web Portal).
	"""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)

	collector = _get_collector_profile(frappe.session.user)
	
	# Set up queries/filters
	filters = {"collector": collector["name"]}
	if location:
		filters["location"] = location
	if start_date:
		filters["donation_date"] = [">=", start_date]
	if end_date:
		if start_date:
			filters["donation_date"] = ["between", [start_date, end_date]]
		else:
			filters["donation_date"] = ["<=", end_date]

	or_filters = None
	if search:
		search_lower = f"%{search}%"
		matching_persons = frappe.get_all(
			"Person",
			or_filters=[
				["gujarati_fullname", "like", search_lower],
				["english_fullname", "like", search_lower],
				["mobile_number", "like", search_lower]
			],
			pluck="name"
		)
		or_filters = [
			["takti_english", "like", search_lower],
			["takti", "like", search_lower]
		]
		if matching_persons:
			or_filters.append(["takti", "in", matching_persons])

	# Build base query fields
	fields = [
		"name",
		"takti",
		"takti_english",
		"amount_english",
		"donation_date",
		"village",
		"location",
		"docstatus"
	]

	# Determine if paginated
	query_kwargs = {
		"filters": filters,
		"fields": fields,
		"order_by": "creation desc"
	}
	if or_filters:
		query_kwargs["or_filters"] = or_filters

	if page and page_size:
		page = int(page)
		page_size = min(int(page_size), 100)
		offset = (page - 1) * page_size
		query_kwargs["limit"] = page_size
		query_kwargs["limit_start"] = offset

	donations = frappe.get_all("Donation", **query_kwargs)

	# Format translations
	for donation in donations:
		if donation.village:
			donation.village_english = frappe.db.get_value("Village", donation.village, "english_name")
		if donation.location:
			donation.location_english = frappe.db.get_value("Location", donation.location, "location_name_english")

		donor_data = frappe.db.get_value("Person", donation.takti, ["gujarati_fullname", "english_fullname"], as_dict=True)
		if donor_data:
			donation.donor_gujarati = donor_data.gujarati_fullname
			donation.donor_english = donor_data.english_fullname
		else:
			donation.donor_gujarati = donation.takti
			donation.donor_english = donation.takti_english

	# Calculate totals
	overall_total = frappe.db.count("Donation", filters=filters)
	matching_donations = frappe.get_all("Donation", filters=filters, fields=["name", "takti", "amount_english"])
	total_collected_amount = sum((d.get("amount_english") or 0) for d in matching_donations)

	total_donors = 0
	matching_donation_names = [d["name"] for d in matching_donations]
	if matching_donation_names:
		taktis = {d["takti"] for d in matching_donations if d.get("takti")}
		child_donors = {
			d["donor_name"] 
			for d in frappe.get_all("Donor", filters={"parent": ["in", matching_donation_names]}, fields=["donor_name"])
			if d.get("donor_name")
		}
		total_donors = len(taktis.union(child_donors))

	if or_filters:
		filtered_total = frappe.db.count("Donation", filters=filters, or_filters=or_filters)
	else:
		filtered_total = overall_total

	response = {
		"collector": collector,
		"donations": donations,
		"total": filtered_total,
		"total_collected_amount": total_collected_amount,
		"total_donors": total_donors
	}

	if page and page_size:
		response.update({
			"page": page,
			"page_size": page_size,
			"total_pages": -(-filtered_total // page_size)
		})

	return response

@frappe.whitelist()
def get_form_context():
	"""Unified options endpoint returning collector profile, villages, and collector's locations."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
		
	collector = _get_collector_profile(frappe.session.user)
	
	villages = frappe.get_all(
		"Village",
		fields=["name", "english_name"],
		order_by="name asc"
	)

	locations = _get_collector_locations(collector["name"])

	return {
		"collector": collector,
		"villages": villages,
		"locations": locations
	}

@frappe.whitelist()
def search_donor(query, limit=10):
	"""Unified Autocomplete search endpoint to lookup Person records by name or mobile."""
	if not query:
		return []

	donors = frappe.get_all(
		"Person",
		filters={"is_collector": "false"},
		or_filters=[
			["mobile_number", "like", f"%{query}%"],
			["gujarati_fullname", "like", f"%{query}%"],
			["english_fullname", "like", f"%{query}%"]
		],
		fields=["name", "gujarati_fullname", "english_fullname", "mobile_number", "village_gujarati_name"],
		limit=int(limit)
	)

	# Fetch Village details for each donor
	for d in donors:
		if d.village_gujarati_name:
			d.village_english = frappe.db.get_value("Village", d.village_gujarati_name, "english_name")
		else:
			d.village_english = ""

	return donors

@frappe.whitelist()
def get_translation(text):
	"""Unified transliteration endpoint returning Gujarati spelling recommendations."""
	guj, eng = get_translated_names(text)
	
	options = []
	try:
		url = "https://inputtools.google.com/request"
		params = {
			"text": text,
			"itc": "gu-t-i0-und",
			"num": 5
		}
		response = requests.get(url, params=params, timeout=5)
		if response.status_code == 200:
			res = response.json()
			if res and len(res) > 1 and len(res[1]) > 0:
				options = res[1][0].get("suggested_words", [])
	except Exception:
		pass

	# Ensure primary translation is at the top of options
	if guj and guj not in options:
		options.insert(0, guj)
		
	return {
		"gujarati": guj,
		"english": eng,
		"options": options
	}

@frappe.whitelist()
def create_donation(donor_data, amount, village, location, donation_date=None, hastes=None):
	"""
	Unified Donation creation endpoint.
	Parses donor details, handles new Person registrations, divides haste shares,
	inserts the Donation document, and submits it.
	"""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to submit a donation."), frappe.PermissionError)

	collector = _get_collector_profile(frappe.session.user)

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

	# Get or Create Donor Person
	donor_name = donor_data.get("name")
	if donor_name and frappe.db.exists("Person", donor_name):
		donor_doc = frappe.get_doc("Person", donor_name)
		if donor_data.get("mobile_number") and not donor_doc.mobile_number:
			donor_doc.mobile_number = donor_data.get("mobile_number")
			donor_doc.save(ignore_permissions=True)
	else:
		guj_name = donor_data.get("gujarati_fullname", "").strip()
		eng_name = donor_data.get("english_fullname", "").strip()
		mobile = donor_data.get("mobile_number", "").strip()

		if not guj_name and not eng_name:
			frappe.throw(_("Donor name (Gujarati or English) is required."))

		if not guj_name:
			guj_name, _ = get_translated_names(eng_name)
		elif not eng_name:
			_, eng_name = get_translated_names(guj_name)

		if not village:
			frappe.throw(_("Village is required to register a new donor."))

		village_doc = get_or_create_village(village)

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

	if village:
		village_doc = get_or_create_village(village)
		village_link = village_doc.name
	else:
		village_doc = None
		village_link = None

	amount_str = str(amount)
	num_map = {'0':'૦', '1':'૧', '2':'૨', '3':'૩', '4':'૪', '5':'૫', '6':'૬', '7':'૭', '8':'૮', '9':'૯'}
	amount_guj = "".join(num_map.get(char, char) for char in amount_str)

	donation = frappe.get_doc({
		"doctype": "Donation",
		"takti": donor_name,
		"amount_gujarati": amount_guj,
		"amount_english": amount,
		"donation_date": donation_date or "2024-08-01",
		"village": village_link,
		"location": location,
		"collector": collector["name"],
		"list_of_donors": []
	})

	haste_vals = [h.strip() for h in hastes if h and h.strip()]

	if not haste_vals:
		donation.append("list_of_donors", {
			"donor_name": donor_name,
			"amount": amount
		})
	else:
		if not village_doc:
			frappe.throw(_("Village is required to register haste names."))
		
		distributed_amounts = distribute_amount_equally(amount, len(haste_vals))
		for idx, haste_val in enumerate(haste_vals):
			if frappe.db.exists("Person", haste_val):
				haste_person = frappe.get_doc("Person", haste_val)
			else:
				haste_person = get_or_create_person(haste_val, village_doc, '', is_collector=False)
				
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

@frappe.whitelist()
def get_donation_receipt(name):
	"""Unified Donation receipt detail endpoint returning fully translated view variables."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)
	if not name:
		frappe.throw(_("No donation ID provided."))
	if not frappe.db.exists("Donation", name):
		frappe.throw(_("Donation record not found."))

	donation_doc = frappe.get_doc("Donation", name)

	village_english = ""
	if donation_doc.village:
		village_english = frappe.db.get_value("Village", donation_doc.village, "english_name")
	location_english = ""
	if donation_doc.location:
		location_english = frappe.db.get_value("Location", donation_doc.location, "location_name_english")

	takti_data = frappe.db.get_value("Person", donation_doc.takti, ["gujarati_fullname", "english_fullname", "mobile_number"], as_dict=True)
	takti_gujarati = takti_data.gujarati_fullname if takti_data else donation_doc.takti
	takti_english = takti_data.english_fullname if takti_data else donation_doc.takti_english
	takti_mobile = takti_data.mobile_number if takti_data else ""

	collector_data = frappe.db.get_value("Person", donation_doc.collector, ["gujarati_fullname", "english_fullname"], as_dict=True)
	collector_name_guj = collector_data.gujarati_fullname if collector_data else donation_doc.collector
	collector_name_eng = collector_data.english_fullname if collector_data else ""

	donors_list = []
	for d in donation_doc.list_of_donors:
		person_data = frappe.db.get_value("Person", d.donor_name, ["gujarati_fullname", "english_fullname"], as_dict=True)
		donors_list.append({
			"name": d.donor_name,
			"gujarati_fullname": person_data.gujarati_fullname if person_data else d.donor_name,
			"english_fullname": person_data.english_fullname if person_data else "",
			"amount": d.amount
		})

	return {
		"donation": {
			"name": donation_doc.name,
			"donation_date": str(donation_doc.donation_date) if donation_doc.donation_date else None,
			"village": donation_doc.village,
			"location": donation_doc.location,
			"amount_english": donation_doc.amount_english
		},
		"village_english": village_english,
		"location_english": location_english,
		"takti_gujarati": takti_gujarati,
		"takti_english": takti_english,
		"takti_mobile": takti_mobile,
		"collector_name_guj": collector_name_guj,
		"collector_name_eng": collector_name_eng,
		"donors_list": donors_list
	}

@frappe.whitelist()
def get_donation_pdf(name, print_format="Standard"):
	"""Unified Base64 PDF generation endpoint."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in."), frappe.PermissionError)

	donation = frappe.get_doc("Donation", name)
	collector = _get_collector_profile(frappe.session.user)
	
	if donation.collector != collector["name"]:
		frappe.throw(_("Not permitted to download this donation"), frappe.PermissionError)

	html = frappe.get_print("Donation", name, print_format=print_format, as_pdf=False)
	pdf_bytes = get_pdf(html)
	pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

	return {
		"filename": f"Donation-{name}.pdf",
		"pdf_base64": pdf_b64,
	}

# ---------------------------------------------------------------------------
# Home Page Resolver (Desktop Routing)
# ---------------------------------------------------------------------------

def get_website_user_home_page(user):
	if user and user != "Guest":
		is_collector = frappe.db.get_value("Person", {"user": user, "is_collector": "true"}, "name")
		if is_collector:
			return "donations"
	return None
