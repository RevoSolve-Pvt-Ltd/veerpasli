# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import subprocess
import os
import re
import requests
from urllib.parse import urlparse, unquote
from veerpasli.veerpasli.utils.pdf_splitter import get_file_path

class Pdfpage(Document):
	def after_insert(self):
		self.trigger_process_image()

	@frappe.whitelist()
	def trigger_process_image(self):
		frappe.enqueue(
			"veerpasli.veerpasli.doctype.pdf_page.pdf_page.process_image",
			queue="default",
			docname=self.name
		)

def process_image(docname):
	doc = frappe.get_doc("Pdf page", docname)
	if not doc.page_file:
		return
		
	doc.db_set("status", "in process")
	frappe.db.commit()
		
	image_path = get_file_path(doc.page_file)
	script_path = os.path.abspath(os.path.join(frappe.get_app_path("veerpasli"), "..", "ocr.js"))
	
	nvm_sh_path = os.path.expanduser("~/.nvm/nvm.sh")
	cmd = f"source {nvm_sh_path} && nvm exec 24 node {script_path} '{image_path}'"
	
	try:
		result = subprocess.run([cmd], shell=True, capture_output=True, text=True, executable="/bin/bash")
		print(result, 'result of ocr')
		if result.returncode == 0:
			json_web_path = os.path.splitext(doc.page_file)[0] + '.json'
			json_disk_path = get_file_path(json_web_path)
			
			if os.path.exists(json_disk_path):
				from frappe.utils.file_manager import save_file
				with open(json_disk_path, "r") as f:
					file_content = f.read()
				
				os.remove(json_disk_path)
				orig_file_name = frappe.db.get_value(
					"File",
					{
						"file_url": doc.page_file,
						"attached_to_doctype": "Pdf page",
						"attached_to_name": doc.name,
					},
					"file_name"
				)
				if not orig_file_name:
					orig_file_name = os.path.basename(doc.page_file)
				clean_json_name = os.path.splitext(orig_file_name)[0] + '.json'
				
				out = save_file(
					fname=clean_json_name,
					content=file_content,
					dt="Pdf page",
					dn=doc.name,
					folder="Home/Attachments",
					decode=False,
					is_private=1 if doc.page_file.startswith("/private") else 0,
					df="json_file"
				)
				file_doc = out if hasattr(out, "doctype") else frappe.get_doc('File', out)
				
				# Populate ocr_boxes child table from OCR segments
				import json
				try:
					data = json.loads(file_content)
					segments = data.get("segments", [])
					
					# Clear existing boxes
					doc.set("ocr_boxes", [])
					for segment in segments:
						bb = segment.get("boundingBox") or {}
						doc.append("ocr_boxes", {
							"text": segment.get("text"),
							"center_x": bb.get("centerPerX"),
							"center_y": bb.get("centerPerY"),
							"width": bb.get("perWidth"),
							"height": bb.get("perHeight"),
							"status": "original"
						})
				except Exception as e:
					frappe.log_error(title="OCR parsing error", message=f"Error parsing OCR segments for {doc.name}: {str(e)}")
				
				doc.json_file = file_doc.file_url
				doc.status = "completed"
				doc.save(ignore_permissions=True)
			else:
				doc.db_set("status", "completed")
		else:
			doc.db_set("status", "failed")
	except Exception:
		doc.db_set("status", "failed")
	finally:
		frappe.db.commit()

@frappe.whitelist()
def process_ocr_page(image_url, boxes, page_id=None):
	if not image_url:
		frappe.throw("Image URL is required to determine page location.")

	if isinstance(boxes, str):
		boxes = frappe.parse_json(boxes)

	if not isinstance(boxes, list):
		frappe.throw("Invalid boxes payload.")

	location_doc = get_location_from_context(page_id, image_url)
	if not location_doc:
		frappe.throw("Unable to determine page location.")

	# First pass: create villages and collectors (phone boxes)
	collector_cache = {}
	for box in boxes:
		fields = box.get('fields') or {}
		name = (fields.get('name') or '').strip()
		village_name = (fields.get('village') or '').strip()
		phone = (fields.get('phone') or '').strip()

		if not village_name:
			continue

		village_doc = get_or_create_village(village_name)

		if phone:
			# create or update collector person and attach location
			person = get_or_create_person(
				name or phone,
				village_doc,
				phone,
				is_collector=True,
				location_name=location_doc.name
			)
			collector_cache[person.name] = person

	# Second pass: create donations for amount boxes
	donation_count = 0
	for box in boxes:
		fields = box.get('fields') or {}
		name = (fields.get('name') or '').strip()
		village_name = (fields.get('village') or '').strip()
		amount = (fields.get('amount') or '').strip()
		phone = (fields.get('phone') or '').strip()

		if not village_name or not amount:
			continue

		village_doc = get_or_create_village(village_name)

		# create donor person (not a collector)
		donor = get_or_create_person(
			name or 'Unknown Donor',
			village_doc,
			phone or '',
			is_collector=False
		)

		# find a collector for this location: prefer collectors created on this page
		collector = None
		for p in collector_cache.values():
			for row in getattr(p, 'collector_locations', []) or []:
				if row.location == location_doc.name:
					collector = p
					break
			if collector:
				break

		if not collector:
			# fallback to global search
			collector = find_collector_for_location(location_doc.name)

		if not collector:
			# If still no collector, create a placeholder collector record if phone available in any box
			# Try to find any phone in boxes to make a collector
			fallback_phone = None
			for b in boxes:
				f = (b.get('fields') or {})
				ph = (f.get('phone') or '').strip()
				if ph:
					fallback_phone = ph
					break
			if fallback_phone:
				# create a minimal collector
				collector_person = get_or_create_person(
					fallback_phone,
					village_doc,
					fallback_phone,
					is_collector=True,
					location_name=location_doc.name
				)
				collector = collector_person

		donation = frappe.get_doc({
			'doctype': 'Donation',
			'takti': donor.name,
			'amount_gujarati': amount,
			'amount_english': parse_amount_english(amount),
			'village': village_doc.name,
			'location': location_doc.name,
			'collector': collector.name if collector else None
		})
		donation.insert(ignore_permissions=True)
		donation_count += 1

	return {
		'donation_count': donation_count,
		'collector_count': len(collector_cache)
	}


@frappe.whitelist()
def process_ocr_box(image_url, box, page_id=None):
	if not image_url:
		frappe.throw("Image URL is required to determine page location.")

	if isinstance(box, str):
		box = frappe.parse_json(box)

	if not isinstance(box, dict):
		frappe.throw("Invalid box payload.")

	entry_type = (box.get('type') or '').strip().lower()
	fields = box.get('fields') or {}
	name = (fields.get('name') or '').strip()
	village_name = (fields.get('village') or '').strip()
	amount = (fields.get('amount') or '').strip()
	phone = (fields.get('phone') or '').strip()
	ref_person_id = fields.get('reference_person')
	ref_donation_id = fields.get('reference_donation')

	center_x = box.get('centerPerX')
	center_y = box.get('centerPerY')
	width = box.get('perWidth')
	height = box.get('perHeight')

	if entry_type not in ('collector', 'donation'):
		frappe.throw("Entry type must be Collector or Donation.")

	if not name:
		frappe.throw("Name is required.")

	location_doc = get_location_from_context(page_id, image_url)
	if not location_doc:
		frappe.throw("Unable to determine page location.")

	if entry_type == 'collector':
		# Clean up previous donation if entry type changed
		if ref_donation_id and frappe.db.exists('Donation', ref_donation_id):
			try:
				donation_doc = frappe.get_doc('Donation', ref_donation_id)
				old_donor_id = donation_doc.takti
				old_village_name = donation_doc.village
				remove_person_tagged_box('Donation', ref_donation_id)
				frappe.delete_doc('Donation', ref_donation_id, ignore_permissions=True)
				if old_donor_id and frappe.db.exists('Person', old_donor_id):
					if frappe.db.count('Donation', {'takti': old_donor_id}) == 0:
						frappe.delete_doc('Person', old_donor_id, ignore_permissions=True)
				if old_village_name:
					handle_village_correction(old_village_name, '')
			except Exception:
				pass
			ref_donation_id = None

		person_id = ref_person_id
		effective_village = village_name or 'Unknown Village'

		if person_id and frappe.db.exists('Person', person_id):
			# Step 1: Rename primary key first (also syncs gujarati_fullname via update_autoname_field)
			guj_name, eng_name = get_translated_names(name)
			target_name = f"{guj_name} - {effective_village}"
			if person_id != target_name:
				try:
					target_exists = frappe.db.exists('Person', target_name)
					person_id = frappe.rename_doc('Person', person_id, target_name, force=True, merge=target_exists, ignore_permissions=True)
				except Exception:
					frappe.log_error(frappe.get_traceback(), 'Collector rename failed in process_ocr_box')

			# Step 2: Get the correct village (create if needed) and read the old one for cleanup
			old_person_village = frappe.db.get_value('Person', person_id, 'village_gujarati_name') or ''
			village_doc = get_or_create_village(effective_village)

			# Step 3: Update all remaining fields directly in DB (safe, bypasses unique constraint on autoname field)
			current_mobile = frappe.db.get_value('Person', person_id, 'mobile_number') or ''
			frappe.db.set_value('Person', person_id, {
				'gujarati_fullname': guj_name,
				'english_fullname': eng_name,
				'mobile_number': normalize_mobile_number(phone) if phone else current_mobile,
				'village_gujarati_name': village_doc.name,
				'village_english_name': village_doc.english_name,
				'is_collector': 'true',
			})

			# Step 4: Clean up the old village AFTER the person is updated in DB
			# (so person_count = 0 for old village, allowing safe deletion)
			if old_person_village and old_person_village != village_doc.name:
				cleanup_village_if_orphaned(old_person_village)

			# Add the location to collector locations if not already present
			person_doc = frappe.get_doc('Person', person_id)
			add_collector_location(person_doc, location_doc.name)
		else:
			village_doc = get_or_create_village(effective_village)
			person = get_or_create_person(
				name,
				village_doc,
				phone or '',
				is_collector=True,
				location_name=location_doc.name
			)
			person_id = person.name

		if center_x is not None:
			remove_person_tagged_box('Collector', f"{person_id}:{location_doc.name}")
			update_person_tagged_box(person_id, image_url, center_x, center_y, width, height, 'Collector', f"{person_id}:{location_doc.name}")

		return {
			'type': 'collector',
			'person': person_id,
			'donation': None
		}

	if not amount:
		frappe.throw("Amount is required for Donation.")

	# Clean up previous collector if entry type changed
	if ref_person_id and frappe.db.exists('Person', ref_person_id):
		try:
			if frappe.db.count('Donation', {'takti': ref_person_id}) == 0 and frappe.db.count('Donation', {'collector': ref_person_id}) == 0:
				person_doc = frappe.get_doc('Person', ref_person_id)
				old_village_name = person_doc.village_gujarati_name
				frappe.delete_doc('Person', ref_person_id, ignore_permissions=True)
				if old_village_name:
					handle_village_correction(old_village_name, '')
		except Exception:
			pass
		ref_person_id = None

	village_doc = get_or_create_village(village_name or 'Unknown Village')
	donation_id = ref_donation_id

	# Parse hastes from fields
	hastes_input = fields.get('hastes') or []
	haste_names = [h.get('name').strip() for h in hastes_input if h and h.get('name')]

	if donation_id and frappe.db.exists('Donation', donation_id):
		donation = frappe.get_doc('Donation', donation_id)
		old_donor_id = donation.takti
		old_village_name = donation.village

		# Get list of old haste person IDs from the existing child table before we clear it
		old_haste_ids = []
		if hasattr(donation, 'list_of_donors') and donation.list_of_donors:
			old_haste_ids = [row.donor_name for row in donation.list_of_donors if row.donor_name]

		# --- PERSON CORRECTION ---
		if old_donor_id and frappe.db.exists('Person', old_donor_id):
			donation_count_for_donor = frappe.db.count('Donation', {'takti': old_donor_id})
			if donation_count_for_donor <= 1:
				# Step 1: Rename primary key first (also syncs gujarati_fullname via update_autoname_field)
				donor_id = old_donor_id
				guj_name, eng_name = get_translated_names(name)
				target_name = f"{guj_name} - {village_doc.name}"
				if old_donor_id != target_name:
					try:
						target_exists = frappe.db.exists('Person', target_name)
						donor_id = frappe.rename_doc('Person', old_donor_id, target_name, force=True, merge=target_exists, ignore_permissions=True)
					except Exception:
						frappe.log_error(frappe.get_traceback(), 'Person rename failed in process_ocr_box')

				# Step 2: Update all remaining fields directly in DB (bypasses unique constraint on autoname field)
				current_mobile = frappe.db.get_value('Person', donor_id, 'mobile_number') or ''
				frappe.db.set_value('Person', donor_id, {
					'gujarati_fullname': guj_name,
					'english_fullname': eng_name,
					'mobile_number': normalize_mobile_number(phone) if phone else current_mobile,
					'village_gujarati_name': village_doc.name,
					'village_english_name': village_doc.english_name,
				})
			else:
				# Person is shared — leave it, find/create the correct one
				donor = get_or_create_person(name, village_doc, phone or '', is_collector=False)
				donor_id = donor.name
		else:
			donor = get_or_create_person(name, village_doc, phone or '', is_collector=False)
			donor_id = donor.name

		# Reload the donation to get a fresh state (rename_doc may have auto-updated takti in DB)
		donation = frappe.get_doc('Donation', donation_id)

		# Clear and rebuild child table
		donation.set('list_of_donors', [])
		total_amount_english = parse_amount_english(amount)
		hastes_data = []

		if not haste_names:
			donation.append('list_of_donors', {
				'donor_name': donor_id,
				'amount': total_amount_english
			})
		else:
			distributed_amounts = distribute_amount_equally(total_amount_english, len(haste_names))
			for idx, haste_name in enumerate(haste_names):
				haste_person = get_or_create_person(haste_name, village_doc, '', is_collector=False)
				donation.append('list_of_donors', {
					'donor_name': haste_person.name,
					'amount': distributed_amounts[idx]
				})
				hastes_data.append({
					'name': haste_name,
					'reference_person': haste_person.name
				})

		# Update Donation fields
		donation.takti = donor_id
		donation.amount_gujarati = amount
		donation.amount_english = total_amount_english
		donation.village = village_doc.name
		donation.location = location_doc.name
		donation.ocr_image_url = image_url
		donation.ocr_box_x = center_x
		donation.ocr_box_y = center_y
		donation.ocr_box_w = width
		donation.ocr_box_h = height
		donation.donation_date = fields.get('donation_date') or '2024-08-01'

		collector = find_collector_for_location(location_doc.name)
		if collector:
			donation.collector = collector.name

		donation.save(ignore_permissions=True)

		if center_x is not None:
			remove_person_tagged_box('Donation', donation.name)
			update_person_tagged_box(donation.takti, image_url, center_x, center_y, width, height, 'Donation', donation.name)
			for d_row in donation.list_of_donors:
				if d_row.donor_name != donation.takti:
					update_person_tagged_box(d_row.donor_name, image_url, center_x, center_y, width, height, 'Donation', donation.name)

		# NOW clean up the old village (donation is saved, so DB references are correct)
		if old_village_name and old_village_name != village_doc.name:
			cleanup_village_if_orphaned(old_village_name)

		# NOW clean up old Haste persons that are no longer referenced
		for old_haste_id in old_haste_ids:
			cleanup_person_if_orphaned(old_haste_id)
	else:
		donor = get_or_create_person(
			name,
			village_doc,
			phone or '',
			is_collector=False
		)
		donor_id = donor.name
		collector = find_collector_for_location(location_doc.name)
		if not collector:
			frappe.throw(
				f"No collector person found for location {location_doc.name}. Create a Collector entry first."
			)

		total_amount_english = parse_amount_english(amount)
		hastes_data = []

		donation = frappe.get_doc({
			'doctype': 'Donation',
			'takti': donor_id,
			'amount_gujarati': amount,
			'amount_english': total_amount_english,
			'village': village_doc.name,
			'location': location_doc.name,
			'collector': collector.name,
			'list_of_donors': [],
			'ocr_image_url': image_url,
			'ocr_box_x': center_x,
			'ocr_box_y': center_y,
			'ocr_box_w': width,
			'ocr_box_h': height,
			'donation_date': fields.get('donation_date') or '2024-08-01'
		})

		if not haste_names:
			donation.append('list_of_donors', {
				'donor_name': donor_id,
				'amount': total_amount_english
			})
		else:
			distributed_amounts = distribute_amount_equally(total_amount_english, len(haste_names))
			for idx, haste_name in enumerate(haste_names):
				haste_person = get_or_create_person(haste_name, village_doc, '', is_collector=False)
				donation.append('list_of_donors', {
					'donor_name': haste_person.name,
					'amount': distributed_amounts[idx]
				})
				hastes_data.append({
					'name': haste_name,
					'reference_person': haste_person.name
				})

		donation.insert(ignore_permissions=True)
		donation_id = donation.name

		if center_x is not None:
			update_person_tagged_box(donation.takti, image_url, center_x, center_y, width, height, 'Donation', donation_id)
			for d_row in donation.list_of_donors:
				if d_row.donor_name != donation.takti:
					update_person_tagged_box(d_row.donor_name, image_url, center_x, center_y, width, height, 'Donation', donation_id)

	return {
		'type': 'donation',
		'donation': donation_id,
		'person': donor_id,
		'hastes': hastes_data
	}


@frappe.whitelist()
def mark_pdf_page_verified(page_id=None):
	if not page_id:
		frappe.throw('page_id is required.')

	doc = frappe.get_doc('Pdf page', page_id)
	doc.db_set('status', 'verified')
	frappe.db.commit()

	return {
		'success': True,
		'page': doc.name
	}


@frappe.whitelist()
def set_person_profile(person_name, file_url):
	if not person_name or not file_url:
		frappe.throw("Person name and file URL are required.")
	doc = frappe.get_doc("Person", person_name)
	doc.profile = file_url
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"success": True}


@frappe.whitelist()
def get_ocr_boxes(page_id):
	import json
	doc = frappe.get_doc("Pdf page", page_id)
	if not doc.ocr_boxes and doc.json_file:
		# Populate child table from JSON file (one-time migration)
		json_path = get_file_path(doc.json_file)
		if os.path.exists(json_path):
			try:
				with open(json_path, 'r', encoding='utf-8') as f:
					data = json.loads(f.read())
				segments = data.get("segments", [])
				verified = data.get("verified", [])
				
				for box in verified:
					bb = box.get("boundingBox", {})
					fields = box.get("fields", {})
					doc.append("ocr_boxes", {
						"text": box.get("text"),
						"center_x": bb.get("centerPerX"),
						"center_y": bb.get("centerPerY"),
						"width": bb.get("perWidth"),
						"height": bb.get("perHeight"),
						"person_name": fields.get("name"),
						"village": fields.get("village"),
						"amount": fields.get("amount"),
						"phone": fields.get("phone"),
						"entry_type": fields.get("entryType") or fields.get("entry_type"),
						"status": "verified"
					})
				
				verified_keys = {
					(v.get("text"), v.get("boundingBox", {}).get("centerPerX"), v.get("boundingBox", {}).get("centerPerY"))
					for v in verified if v and v.get("boundingBox")
				}
				
				for segment in segments:
					bb = segment.get("boundingBox", {})
					key = (segment.get("text"), bb.get("centerPerX"), bb.get("centerPerY"))
					if key not in verified_keys:
						doc.append("ocr_boxes", {
							"text": segment.get("text"),
							"center_x": bb.get("centerPerX"),
							"center_y": bb.get("centerPerY"),
							"width": bb.get("perWidth"),
							"height": bb.get("perHeight"),
							"status": "original"
						})
				doc.save(ignore_permissions=True)
				frappe.db.commit()
			except Exception as e:
				frappe.log_error(title="JSON migration error", message=f"Error migrating JSON to child table for {page_id}: {str(e)}")
	
	# Deduplicate existing ocr_boxes in the database if duplicates exist
	seen = {}
	duplicates_found = False
	unique_boxes = []
	for row in doc.ocr_boxes:
		cx = round(row.center_x or 0.0, 4)
		cy = round(row.center_y or 0.0, 4)
		w = round(row.width or 0.0, 4)
		h = round(row.height or 0.0, 4)
		key = (row.text, cx, cy, w, h)
		if key in seen:
			duplicates_found = True
			existing_row = seen[key]
			if existing_row.status != "verified" and row.status == "verified":
				unique_boxes.remove(existing_row)
				seen[key] = row
				unique_boxes.append(row)
		else:
			seen[key] = row
			unique_boxes.append(row)

	if duplicates_found:
		doc.set("ocr_boxes", [])
		for row in unique_boxes:
			doc.append("ocr_boxes", {
				"text": row.text,
				"center_x": row.center_x,
				"center_y": row.center_y,
				"width": row.width,
				"height": row.height,
				"person_name": row.person_name,
				"village": row.village,
				"amount": row.amount,
				"phone": row.phone,
				"entry_type": row.entry_type,
				"status": row.status,
				"reference_person": row.reference_person,
				"reference_donation": row.reference_donation
			})
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	# Convert child table to the format expected by ocr_checker.js
	boxes = []
	for row in doc.ocr_boxes:
		box_dict = {
			"db_name": row.name,
			"text": row.text,
			"status": row.status,
			"boundingBox": {
				"centerPerX": row.center_x,
				"centerPerY": row.center_y,
				"perWidth": row.width,
				"perHeight": row.height
			},
			"fields": {
				"name": row.person_name or "",
				"village": row.village or "",
				"amount": row.amount or "",
				"phone": row.phone or "",
				"entryType": row.entry_type or "",
				"reference_person": row.reference_person or "",
				"reference_donation": row.reference_donation or "",
				"donation_date": row.donation_date or (frappe.db.get_value("Donation", row.reference_donation, "donation_date") if row.reference_donation else ""),
				"hastes": frappe.parse_json(row.hastes) if row.hastes else []
			},
			"merged_from": frappe.parse_json(row.merged_from) if getattr(row, 'merged_from', None) else []
		}
		boxes.append(box_dict)
		
	return {
		"image_url": doc.page_file,
		"boxes": boxes,
		"status": doc.status
	}


@frappe.whitelist()
def update_ocr_boxes(page_id, boxes):
	if isinstance(boxes, str):
		boxes = frappe.parse_json(boxes)
	
	doc = frappe.get_doc("Pdf page", page_id)
	
	# Detect deleted verified boxes for cleanup
	old_refs = []
	for old_box in doc.ocr_boxes or []:
		if old_box.status == 'verified':
			old_refs.append({
				'donation': old_box.reference_donation,
				'person': old_box.reference_person,
				'entry_type': old_box.entry_type
			})

	new_donations = set()
	new_persons = set()
	for box in boxes:
		status = box.get("status") or "original"
		if status == 'verified':
			fields = box.get("fields") or {}
			if fields.get("reference_donation"):
				new_donations.add(fields.get("reference_donation"))
			if fields.get("reference_person"):
				new_persons.add(fields.get("reference_person"))

	for ref in old_refs:
		if ref['donation'] and ref['donation'] not in new_donations:
			if frappe.db.exists('Donation', ref['donation']):
				try:
					donation_doc = frappe.get_doc('Donation', ref['donation'])
					old_donor_id = donation_doc.takti
					old_village_name = donation_doc.village
					old_haste_ids = []
					if hasattr(donation_doc, 'list_of_donors') and donation_doc.list_of_donors:
						old_haste_ids = [row.donor_name for row in donation_doc.list_of_donors if row.donor_name]
					
					remove_person_tagged_box('Donation', ref['donation'])
					frappe.delete_doc('Donation', ref['donation'], ignore_permissions=True)
					
					if old_donor_id:
						cleanup_person_if_orphaned(old_donor_id)
					for old_haste_id in old_haste_ids:
						cleanup_person_if_orphaned(old_haste_id)
					if old_village_name:
						cleanup_village_if_orphaned(old_village_name)
				except Exception:
					pass

		if ref['person'] and ref['person'] not in new_persons:
			if ref['entry_type'] == 'collector':
				try:
					# Clean up using the page's actual location if set
					location_name = doc.location
					if location_name:
						remove_person_tagged_box('Collector', f"{ref['person']}:{location_name}")
					# Also clean up using the filename-parsed location for legacy compatibility
					filename_loc = extract_location_from_image_url(doc.name)
					if filename_loc and filename_loc != location_name:
						remove_person_tagged_box('Collector', f"{ref['person']}:{filename_loc}")
					cleanup_person_if_orphaned(ref['person'])
				except Exception:
					pass

	existing_rows_dict = {row.name: row for row in doc.ocr_boxes}
	updated_row_names = set()
	appends = []
	
	for box in boxes:
		bb = box.get("boundingBox") or {}
		fields = box.get("fields") or {}
		db_name = box.get("db_name")
		
		# If row exists, update it in place
		if db_name and db_name in existing_rows_dict:
			row = existing_rows_dict[db_name]
			row.text = box.get("text")
			row.center_x = bb.get("centerPerX")
			row.center_y = bb.get("centerPerY")
			row.width = bb.get("perWidth")
			row.height = bb.get("perHeight")
			row.person_name = fields.get("name")
			row.village = fields.get("village")
			row.amount = fields.get("amount")
			row.phone = fields.get("phone")
			row.entry_type = fields.get("entryType") or fields.get("entry_type")
			row.status = box.get("status") or "original"
			row.reference_person = fields.get("reference_person")
			row.reference_donation = fields.get("reference_donation")
			row.donation_date = fields.get("donation_date") or None
			row.hastes = frappe.as_json(fields.get("hastes") or [])
			row.merged_from = frappe.as_json(box.get("merged_from") or [])
			updated_row_names.add(db_name)
		else:
			# Otherwise append a new row
			new_row = doc.append("ocr_boxes", {
				"text": box.get("text"),
				"center_x": bb.get("centerPerX"),
				"center_y": bb.get("centerPerY"),
				"width": bb.get("perWidth"),
				"height": bb.get("perHeight"),
				"person_name": fields.get("name"),
				"village": fields.get("village"),
				"amount": fields.get("amount"),
				"phone": fields.get("phone"),
				"entry_type": fields.get("entryType") or fields.get("entry_type"),
				"status": box.get("status") or "original",
				"reference_person": fields.get("reference_person"),
				"reference_donation": fields.get("reference_donation"),
				"donation_date": fields.get("donation_date") or None,
				"hastes": frappe.as_json(fields.get("hastes") or []),
				"merged_from": frappe.as_json(box.get("merged_from") or [])
			})
			appends.append((box.get("id"), new_row))

	# Delete rows that are not in the updated list
	for name, row in existing_rows_dict.items():
		if name not in updated_row_names:
			doc.ocr_boxes.remove(row)
			
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	
	updated_mappings = []
	for client_id, row in appends:
		updated_mappings.append({"id": client_id, "db_name": row.name})
		
	return {"success": True, "mappings": updated_mappings}


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


def get_location_from_context(page_id=None, image_url=None):
	location_doc = None
	if page_id and frappe.db.exists("Pdf page", page_id):
		page_loc = frappe.db.get_value("Pdf page", page_id, "location")
		if page_loc:
			location_doc = frappe.get_doc("Location", page_loc)
	if not location_doc and image_url:
		parsed_url = urlparse(image_url)
		clean_url = unquote(parsed_url.path or image_url)
		page_loc = frappe.db.get_value("Pdf page", {"page_file": clean_url}, "location")
		if not page_loc:
			page_loc = frappe.db.get_value("Pdf page", {"page_file": ["like", f"%{os.path.basename(clean_url)}%"]}, "location")
		if page_loc:
			location_doc = frappe.get_doc("Location", page_loc)

	if not location_doc:
		if page_id:
			location_name = extract_location_from_image_url(page_id)
		elif image_url:
			location_name = extract_location_from_image_url(image_url)
		else:
			location_name = None

		if location_name:
			location_doc = get_or_create_location(location_name)

	return location_doc


def normalize_mobile_number(mobile):
	if not mobile:
		return ''
	mobile = str(mobile).strip()
	# Remove spaces and common separators
	mobile = re.sub(r'[\s\-\(\)]', '', mobile)
	# If already starts with +, assume it's fine
	if mobile.startswith('+'):
		return mobile
	# If starts with 0, replace leading 0 with +91
	if mobile.startswith('0'):
		return '+91-' + mobile.lstrip('0')
	# If 10 digits, assume Indian number and prefix +91
	digits = re.sub(r'\D', '', mobile)
	if len(digits) == 10:
		return '+91-' + digits
	# Fallback: prefix +91 if not present
	return '+91-' + digits if digits else ''


def get_or_create_location(location_name):
	location_name = location_name.strip()
	guj_name, eng_name = get_translated_names(location_name)
	
	docname = frappe.db.get_value('Location', {'location_name': guj_name})
	if not docname and eng_name:
		docname = frappe.db.get_value('Location', {'location_name_english': eng_name})
		
	if docname:
		location = frappe.get_doc('Location', docname)
		updated = False
		if guj_name and location.location_name != guj_name:
			location.location_name = guj_name
			updated = True
		if eng_name and location.location_name_english != eng_name:
			location.location_name_english = eng_name
			updated = True
		if updated:
			location.save(ignore_permissions=True)
		return location

	location = frappe.get_doc({
		'doctype': 'Location',
		'location_name': guj_name,
		'location_name_english': eng_name
	})
	location.insert(ignore_permissions=True)
	return location


def translate_text(text, source_lang, target_lang):
	if not text:
		return ""
	try:
		url = "https://translate.googleapis.com/translate_a/single"
		params = {
			"client": "gtx",
			"sl": source_lang,
			"tl": target_lang,
			"dt": "t",
			"q": text
		}
		response = requests.get(url, params=params, timeout=10)
		response.raise_for_status()
		res_json = response.json()
		if res_json and len(res_json) > 0 and len(res_json[0]) > 0:
			translated_text = res_json[0][0][0]
			return translated_text.strip()
	except Exception as e:
		frappe.log_error(title="Translation failed in pdf_page", message=f"Error: {str(e)}")
	return text

def is_non_ascii(text):
	return any(ord(c) > 127 for c in (text or ""))

def get_translated_names(text):
	text = (text or "").strip()
	if not text:
		return "", ""
	if is_non_ascii(text):
		guj_name = text
		eng_name = translate_text(text, "gu", "en")
	else:
		eng_name = text
		guj_name = translate_text(text, "en", "gu")
	return guj_name, eng_name


def get_or_create_village(village_name):
	if not village_name:
		return None
	village_name = village_name.strip()
	if frappe.db.exists('Village', village_name):
		return frappe.get_doc('Village', village_name)

	guj_name, eng_name = get_translated_names(village_name)
	
	docname = frappe.db.get_value('Village', {'gujarati_name': guj_name})
	if not docname and eng_name:
		docname = frappe.db.get_value('Village', {'english_name': eng_name})
		
	if docname:
		village = frappe.get_doc('Village', docname)
		updated = False
		if guj_name and village.gujarati_name != guj_name:
			village.gujarati_name = guj_name
			updated = True
		if eng_name and village.english_name != eng_name:
			village.english_name = eng_name
			updated = True
		if updated:
			village.save(ignore_permissions=True)
		return village

	village = frappe.get_doc({
		'doctype': 'Village',
		'gujarati_name': guj_name,
		'english_name': eng_name
	})
	village.insert(ignore_permissions=True)
	return village


def cleanup_village_if_orphaned(village_name):
	"""
	Deletes a village if no Person or Donation is still referencing it.
	Called AFTER the person and donation have already been updated to the new village.
	"""
	village_name = (village_name or '').strip()
	if not village_name or not frappe.db.exists('Village', village_name):
		return
	person_count = frappe.db.count('Person', {'village_gujarati_name': village_name})
	donation_count = frappe.db.count('Donation', {'village': village_name})
	if person_count == 0 and donation_count == 0:
		try:
			frappe.delete_doc('Village', village_name, ignore_permissions=True)
		except Exception:
			frappe.log_error(frappe.get_traceback(), 'Village delete failed in cleanup_village_if_orphaned')


def handle_village_correction(old_village_name, new_village_name):
	"""
	Safely updates the village link. If the old village was only used by this correction,
	we delete it (if new_village exists) or rename it (if new_village doesn't exist).
	"""
	old_village_name = (old_village_name or '').strip()
	new_village_name = (new_village_name or '').strip()
	if not old_village_name or old_village_name == new_village_name:
		if new_village_name:
			return get_or_create_village(new_village_name)
		return None

	person_count = frappe.db.count('Person', {'village_gujarati_name': old_village_name})
	donation_count = frappe.db.count('Donation', {'village': old_village_name})

	# If it is only used by the current record being corrected, we can rename or merge/delete it
	if person_count <= 1 and donation_count <= 1:
		try:
			target_exists = frappe.db.exists('Village', new_village_name)
			rename_to = frappe.rename_doc('Village', old_village_name, new_village_name, force=True, merge=target_exists, ignore_permissions=True)
			return frappe.get_doc('Village', rename_to)
		except Exception:
			return get_or_create_village(new_village_name)
	else:
		return get_or_create_village(new_village_name)


def distribute_amount_equally(total_amount, num_parts):
	if num_parts <= 0:
		return []
	base_amount = total_amount // num_parts
	remainder = total_amount % num_parts
	amounts = [base_amount] * num_parts
	for i in range(remainder):
		amounts[i] += 1
	return amounts


def get_person_reference_count(person_id):
	takti_count = frappe.db.count('Donation', {'takti': person_id})
	collector_count = frappe.db.count('Donation', {'collector': person_id})
	donor_table_count = frappe.db.count('Donor', {'donor_name': person_id})
	return takti_count + collector_count + donor_table_count


def cleanup_person_if_orphaned(person_id):
	if not person_id or not frappe.db.exists('Person', person_id):
		return
	if get_person_reference_count(person_id) == 0:
		try:
			person_doc = frappe.get_doc('Person', person_id)
			old_village_name = person_doc.village_gujarati_name
			frappe.delete_doc('Person', person_id, ignore_permissions=True)
			if old_village_name:
				cleanup_village_if_orphaned(old_village_name)
		except Exception:
			pass


def get_or_create_person(name, village_doc, mobile_number, is_collector=False, location_name=None):
	name = (name or '').strip() or mobile_number or 'Unknown Person'
	# Normalize mobile number to Indian format when possible
	mobile_number = normalize_mobile_number(mobile_number)
	
	guj_name, eng_name = get_translated_names(name)
	
	docname = None
	if mobile_number:
		docname = frappe.db.get_value('Person', {'mobile_number': mobile_number})
	if not docname:
		docname = frappe.db.get_value('Person', {
			'gujarati_fullname': guj_name,
			'village_gujarati_name': village_doc.name
		})
	if not docname and eng_name:
		docname = frappe.db.get_value('Person', {
			'english_fullname': eng_name,
			'village_gujarati_name': village_doc.name
		})
		
	if docname:
		person = frappe.get_doc('Person', docname)
		if is_collector and person.is_collector != 'true':
			person.is_collector = 'true'
		if is_collector and location_name:
			add_collector_location(person, location_name)
		# Update phone if missing or different
		if mobile_number and person.mobile_number != mobile_number:
			person.mobile_number = mobile_number
			
		updated = False
		if guj_name and person.gujarati_fullname != guj_name:
			person.gujarati_fullname = guj_name
			updated = True
		if eng_name and person.english_fullname != eng_name:
			person.english_fullname = eng_name
			updated = True
		if updated:
			person.save(ignore_permissions=True)
		return person

	person = frappe.get_doc({
		'doctype': 'Person',
		'gujarati_fullname': guj_name,
		'english_fullname': eng_name,
		'mobile_number': mobile_number,
		'village_gujarati_name': village_doc.name,
		'village_english_name': village_doc.english_name,
		'is_collector': 'true' if is_collector else 'false'
	})
	if is_collector and location_name:
		person.append('collector_locations', {'location': location_name})
	person.insert(ignore_permissions=True)
	return person


def add_collector_location(person, location_name):
	if not hasattr(person, 'collector_locations'):
		return
	if person.collector_locations:
		for row in person.collector_locations:
			if row.location == location_name:
				return
	person.append('collector_locations', {'location': location_name})
	person.save(ignore_permissions=True)


def find_collector_for_location(location_name):
	collector_records = frappe.get_all('Person', filters={'is_collector': 'true'}, fields=['name'])
	for record in collector_records:
		person = frappe.get_doc('Person', record.name)
		for row in person.collector_locations or []:
			if row.location == location_name:
				return person
	if collector_records:
		return frappe.get_doc('Person', collector_records[0].name)
	return None


def parse_amount_english(amount_text):
	if not amount_text:
		return None
	digits = re.findall(r'\d+', amount_text.replace(',', ''))
	if not digits:
		return None
	return int(''.join(digits))


def update_person_tagged_box(person_name, image_url, center_x, center_y, width, height, reference_doctype, reference_name):
	if not person_name or not frappe.db.exists('Person', person_name):
		return
	if not image_url:
		return

	person = frappe.get_doc('Person', person_name)
	
	existing_row = None
	for row in person.tagged_boxes or []:
		if row.reference_doctype == reference_doctype and row.reference_name == reference_name:
			existing_row = row
			break
		if row.image_url == image_url and abs((row.center_x or 0) - (center_x or 0)) < 0.001 and abs((row.center_y or 0) - (center_y or 0)) < 0.001:
			existing_row = row
			break

	if existing_row:
		existing_row.image_url = image_url
		existing_row.center_x = center_x
		existing_row.center_y = center_y
		existing_row.width = width
		existing_row.height = height
	else:
		person.append('tagged_boxes', {
			'image_url': image_url,
			'center_x': center_x,
			'center_y': center_y,
			'width': width,
			'height': height,
			'reference_doctype': reference_doctype,
			'reference_name': reference_name
		})
	person.save(ignore_permissions=True)


def remove_person_tagged_box(reference_doctype, reference_name):
	rows = frappe.db.get_all('Person Tagged Box', filters={
		'parenttype': 'Person',
		'reference_doctype': reference_doctype,
		'reference_name': reference_name
	}, fields=['parent'])
	
	for r in rows:
		person = frappe.get_doc('Person', r.parent)
		new_tagged_boxes = [row for row in person.tagged_boxes if not (row.reference_doctype == reference_doctype and row.reference_name == reference_name)]
		if len(new_tagged_boxes) != len(person.tagged_boxes):
			person.set('tagged_boxes', new_tagged_boxes)
			person.save(ignore_permissions=True)


@frappe.whitelist()
def ocr_crop(page_id, box):
	if isinstance(box, str):
		import json
		box = json.loads(box)
		
	doc = frappe.get_doc("Pdf page", page_id)
	if not doc.page_file:
		frappe.throw("Page file not found")
		
	# Get paths
	image_path = get_file_path(doc.page_file)
	
	from PIL import Image
	img = Image.open(image_path)
	img_w, img_h = img.size
	
	# Bounding box coordinates
	center_x = box.get("centerPerX")
	center_y = box.get("centerPerY")
	width_p = box.get("perWidth")
	height_p = box.get("perHeight")
	
	left = int((center_x - width_p / 2) * img_w)
	top = int((center_y - height_p / 2) * img_h)
	right = int((center_x + width_p / 2) * img_w)
	bottom = int((center_y + height_p / 2) * img_h)
	
	# Clamp boundaries
	left = max(0, min(left, img_w))
	top = max(0, min(top, img_h))
	right = max(0, min(right, img_w))
	bottom = max(0, min(bottom, img_h))
	
	# Crop
	cropped = img.crop((left, top, right, bottom))
	
	# Save temporary crop image
	import uuid
	temp_filename = f"temp_crop_{uuid.uuid4().hex}"
	temp_img_path = frappe.get_site_path("public", "files", f"{temp_filename}.png")
	temp_json_path = frappe.get_site_path("public", "files", f"{temp_filename}.json")
	
	cropped.save(temp_img_path)
	
	# Run ocr.js
	script_path = os.path.abspath(os.path.join(frappe.get_app_path("veerpasli"), "..", "ocr.js"))
	nvm_sh_path = os.path.expanduser("~/.nvm/nvm.sh")
	cmd = f"source {nvm_sh_path} && nvm exec 24 node {script_path} {temp_img_path}"
	
	text = ""
	try:
		result = subprocess.run([cmd], shell=True, capture_output=True, text=True, executable="/bin/bash")
		if result.returncode == 0 and os.path.exists(temp_json_path):
			with open(temp_json_path, "r") as f:
				data = json.load(f)
				segments = data.get("segments", [])
				text = " ".join([s.get("text", "") for s in segments if s.get("text")])
	finally:
		# Cleanup temp files
		if os.path.exists(temp_img_path):
			os.remove(temp_img_path)
		if os.path.exists(temp_json_path):
			os.remove(temp_json_path)
			
	return {
		"text": text.strip(),
		"boundingBox": {
			"centerPerX": center_x,
			"centerPerY": center_y,
			"perWidth": width_p,
			"perHeight": height_p
		}
	}


