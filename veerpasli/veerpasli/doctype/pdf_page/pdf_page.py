# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import subprocess
import os
import re
from urllib.parse import urlparse, unquote

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
		
	image_path = frappe.get_site_path(doc.page_file.lstrip('/'))
	script_path = os.path.abspath(os.path.join(frappe.get_app_path("veerpasli"), "..", "ocr.js"))
	
	nvm_sh_path = os.path.expanduser("~/.nvm/nvm.sh")
	cmd = f"source {nvm_sh_path} && nvm exec 24 node {script_path} {image_path}"
	
	try:
		result = subprocess.run([cmd], shell=True, capture_output=True, text=True, executable="/bin/bash")
		if result.returncode == 0:
			json_web_path = os.path.splitext(doc.page_file)[0] + '.json'
			json_disk_path = frappe.get_site_path(json_web_path.lstrip('/'))
			
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
					frappe.log_error(f"Error parsing OCR segments for {doc.name}: {str(e)}")
				
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
def process_ocr_page(image_url, boxes):
	if not image_url:
		frappe.throw("Image URL is required to determine page location.")

	if isinstance(boxes, str):
		boxes = frappe.parse_json(boxes)

	if not isinstance(boxes, list):
		frappe.throw("Invalid boxes payload.")

	location_name = extract_location_from_image_url(image_url)
	if not location_name:
		frappe.throw("Unable to parse location from image filename.")

	# Ensure location exists
	location_doc = get_or_create_location(location_name)

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
def process_ocr_box(image_url, box):
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

	if entry_type not in ('collector', 'donation'):
		frappe.throw("Entry type must be Collector or Donation.")

	if not name:
		frappe.throw("Name is required.")

	location_name = extract_location_from_image_url(image_url)
	if not location_name:
		frappe.throw("Unable to parse location from image filename.")

	location_doc = get_or_create_location(location_name)

	if entry_type == 'collector':
		if not village_name:
			frappe.throw("Village is required for Collector.")

		village_doc = get_or_create_village(village_name)

		person = get_or_create_person(
			name,
			village_doc,
			phone or '',
			is_collector=True,
			location_name=location_doc.name
		)

		return {
			'type': 'collector',
			'person': person.name
		}

	if not amount:
		frappe.throw("Amount is required for Donation.")

	village_doc = get_or_create_village(village_name or 'Unknown Village')

	donor = get_or_create_person(
		name,
		village_doc,
		phone or '',
		is_collector=False
	)

	collector = find_collector_for_location(location_doc.name)
	if not collector:
		frappe.throw(
			f"No collector person found for location {location_doc.name}. Create a Collector entry first."
		)

	donation = frappe.get_doc({
		'doctype': 'Donation',
		'takti': donor.name,
		'amount_gujarati': amount,
		'amount_english': parse_amount_english(amount),
		'village': village_doc.name,
		'location': location_doc.name,
		'collector': collector.name
	})
	donation.insert(ignore_permissions=True)

	return {
		'type': 'donation',
		'donation': donation.name
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
		json_path = frappe.get_site_path(doc.json_file.lstrip('/'))
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
				frappe.log_error(f"Error migrating JSON to child table for {page_id}: {str(e)}")
	
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
				"status": row.status
			})
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	# Convert child table to the format expected by ocr_checker.js
	boxes = []
	for row in doc.ocr_boxes:
		box_dict = {
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
				"entryType": row.entry_type or ""
			}
		}
		boxes.append(box_dict)
		
	return {
		"image_url": doc.page_file,
		"boxes": boxes
	}


@frappe.whitelist()
def update_ocr_boxes(page_id, boxes):
	if isinstance(boxes, str):
		boxes = frappe.parse_json(boxes)
	
	doc = frappe.get_doc("Pdf page", page_id)
	doc.set("ocr_boxes", [])
	
	for box in boxes:
		bb = box.get("boundingBox") or {}
		fields = box.get("fields") or {}
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
			"status": box.get("status") or "original"
		})
		
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"success": True}


def extract_location_from_image_url(image_url):
	parsed = urlparse(image_url)
	path = unquote(parsed.path or image_url)
	filename = os.path.basename(path)
	filename = os.path.splitext(filename)[0]
	match = re.match(r'^veerpasli_(.+)_(\d{4})[-_](\d+)$', filename, re.IGNORECASE)
	if match:
		return match.group(1)
	match = re.match(r'^veerpasli-(.+)-\d{4}-\d+$', filename, re.IGNORECASE)
	return match.group(1) if match else filename


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
	docname = frappe.db.get_value('Location', {'location_name': location_name})
	if docname:
		return frappe.get_doc('Location', docname)
	location = frappe.get_doc({
		'doctype': 'Location',
		'location_name': location_name
	})
	location.insert(ignore_permissions=True)
	return location


def get_or_create_village(village_name):
	village_name = village_name.strip()
	docname = frappe.db.get_value('Village', {'gujarati_name': village_name})
	if docname:
		return frappe.get_doc('Village', docname)
	village = frappe.get_doc({
		'doctype': 'Village',
		'gujarati_name': village_name,
		'english_name': village_name
	})
	village.insert(ignore_permissions=True)
	return village


def get_or_create_person(name, village_doc, mobile_number, is_collector=False, location_name=None):
	name = (name or '').strip() or mobile_number or 'Unknown Person'
	# Normalize mobile number to Indian format when possible
	mobile_number = normalize_mobile_number(mobile_number)
	docname = None
	if mobile_number:
		docname = frappe.db.get_value('Person', {'mobile_number': mobile_number})
	if not docname:
		docname = frappe.db.get_value('Person', {'gujarati_fullname': name})
	if docname:
		person = frappe.get_doc('Person', docname)
		if is_collector and person.is_collector != 'true':
			person.is_collector = 'true'
		if is_collector and location_name:
			add_collector_location(person, location_name)
		# Update phone if missing or different
		if mobile_number and person.mobile_number != mobile_number:
			person.mobile_number = mobile_number
		person.save(ignore_permissions=True)
		return person

	person = frappe.get_doc({
		'doctype': 'Person',
		'gujarati_fullname': name,
		'english_fullname': name,
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
	if not hasattr(person, 'collector_locations') or not person.collector_locations:
		return
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
