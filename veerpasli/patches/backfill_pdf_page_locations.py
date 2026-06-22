import frappe
import os
import re
from urllib.parse import urlparse, unquote

def execute():
	"""
	Backfill the new 'location' field for all existing 'Pdf page' documents
	without updating the modified timestamp or creation time.
	"""
	# Get all Location records
	locations = frappe.db.get_all("Location", fields=["name", "location_name", "location_name_english"])

	def clean_compare(s1, s2):
		if not s1 or not s2:
			return False
		def norm(s):
			return re.sub(r'[^a-z0-9]', '', str(s).lower())
		return norm(s1) == norm(s2)

	def find_matching_location(location_name):
		# Try to find a match in the locations list
		for loc in locations:
			if clean_compare(loc.location_name_english, location_name):
				return loc.name
			if clean_compare(loc.location_name, location_name):
				return loc.name
			if clean_compare(loc.name, location_name):
				return loc.name
		return None

	# Get all Pdf page records
	pages = frappe.db.get_all("Pdf page", fields=["name", "page_file"])
	updated_count = 0

	for page in pages:
		location_name = extract_location_from_image_url(page.name)
		if not location_name:
			continue

		loc_name = find_matching_location(location_name)
		if loc_name:
			frappe.db.set_value("Pdf page", page.name, "location", loc_name, update_modified=False)
			updated_count += 1

	frappe.db.commit()
	print(f"Patched: Updated {updated_count} Pdf page records with location links.")

def extract_location_from_image_url(image_url):
	parsed = urlparse(image_url)
	path = unquote(parsed.path or image_url)
	filename = os.path.basename(path)
	filename = os.path.splitext(filename)[0]
	match = re.match(r'^veerpasli_(.+)_(\d{4})([-_].+)?$', filename, re.IGNORECASE)
	if match:
		return match.group(1)
	match = re.match(r'^veerpasli-(.+)-(\d{4})([-_].+)?$', filename, re.IGNORECASE)
	return match.group(1) if match else filename
