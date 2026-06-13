# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import os
import re
import requests
import pymupdf as fitz
from veerpasli.veerpasli.utils.pdf_splitter import normalize_location, get_file_path


def get_or_create_location(gujarati_name, english_name):
	gujarati_name = gujarati_name.strip()
	english_name = english_name.strip() if english_name else ""
	
	# Try to find by gujarati name first
	docname = frappe.db.get_value('Location', {'location_name': gujarati_name})
	if not docname and english_name:
		# Try to find by english name
		docname = frappe.db.get_value('Location', {'location_name_english': english_name})
		
	if docname:
		location = frappe.get_doc('Location', docname)
		if english_name and location.location_name_english != english_name:
			location.location_name_english = english_name
			location.save(ignore_permissions=True)
		return location

	location = frappe.get_doc({
		'doctype': 'Location',
		'location_name': gujarati_name,
		'location_name_english': english_name
	})
	location.insert(ignore_permissions=True)
	return location


@frappe.whitelist()
def get_input_suggestions(text, lang="gu"):
	if not text:
		return []
	try:
		if lang == "gu":
			url = "https://inputtools.google.com/request"
			params = {
				"text": text,
				"itc": "gu-t-i0-und",
				"num": 13,
				"cp": 0,
				"cs": 1,
				"ie": "utf-8",
				"oe": "utf-8",
				"app": "jsapi"
			}
			response = requests.get(url, params=params, timeout=5)
			response.raise_for_status()
			res_json = response.json()
			if res_json and len(res_json) > 1 and len(res_json[1]) > 0:
				return res_json[1][0][1]
		else:
			# Gujarati -> English translation fallback
			url = "https://translate.googleapis.com/translate_a/single"
			params = {
				"client": "gtx",
				"sl": "gu",
				"tl": "en",
				"dt": "t",
				"q": text
			}
			response = requests.get(url, params=params, timeout=5)
			response.raise_for_status()
			res_json = response.json()
			if res_json and len(res_json) > 0 and len(res_json[0]) > 0:
				translated_text = res_json[0][0][0]
				return [translated_text.strip()]
	except Exception as e:
		frappe.log_error(f"Input suggestions failed: {str(e)}")
	return []


class VeerpasliPDF(Document):
	def validate(self):
		if not self.location_english or not self.location_gujarati:
			frappe.throw("Please enter both English Location and Gujarati Location.")
		
		# Create/Get Location and link it
		location_doc = get_or_create_location(self.location_gujarati, self.location_english)
		self.location = location_doc.name

	@frappe.whitelist()
	def send_to_ocr(self):
		if not self.document_pdf:
			frappe.throw("Please attach a Document PDF first.")
		if not self.location:
			frappe.throw("Please enter a Location.")
		if not self.year:
			frappe.throw("Please enter a Year.")
		if not self.page_number_range:
			frappe.throw("Please enter a Page Number Range.")

		file_path = get_file_path(self.document_pdf)
		if not os.path.exists(file_path):
			frappe.throw(f"File not found at {file_path}")

		with open(file_path, 'rb') as f:
			file_bytes = f.read()

		loc_english = self.location_english
		if not loc_english and self.location:
			loc_english = frappe.db.get_value('Location', self.location, 'location_name_english')
		if not loc_english:
			loc_english = self.location or "unknown"

		location = normalize_location(loc_english)
		year = self.year
		
		# Parse start page from range (e.g. "11-20")
		start_page = 1
		range_match = re.search(r'(\d+)', self.page_number_range)
		if range_match:
			start_page = int(range_match.group(1))

		prefix = 'veerpasli'

		# Open the PDF using PyMuPDF
		doc = fitz.open(stream=file_bytes, filetype='pdf')
		total_pages = len(doc)
		
		created_count = 0
		
		# Loop through each page
		for i in range(total_pages):
			page = doc[i]
			
			# Render page to image (PNG)
			mat = fitz.Matrix(2, 2)
			pix = page.get_pixmap(matrix=mat)
			
			# Convert to bytes
			img_bytes = pix.tobytes('png')
			
			# Calculate actual page number
			current_page_num = start_page + i
			
			# Construct names with .png extension
			new_doc_name = f"{prefix}_{location}_{year}_{current_page_num}"
			new_file_name = f"{new_doc_name}.png"
			
			# Create the File DocType for the image
			single_page_file = frappe.get_doc({
				"doctype": "File",
				"file_name": new_file_name,
				"content": img_bytes,
				"is_private": 0
			})
			single_page_file.save()
			
			# Create the "Pdf page" Record
			try:
				if frappe.db.exists("Pdf page", new_doc_name):
					frappe.delete_doc("Pdf page", new_doc_name, ignore_permissions=True, force=True)
				
				page_doc = frappe.get_doc({
					"doctype": "Pdf page",
					"name": new_doc_name,
					"page_number": current_page_num,
					"page_file": single_page_file.file_url,
					"year": year,
					"status": "pending"
				})
				page_doc.insert()
				created_count += 1
			except Exception as e:
				frappe.log_error(f"Error creating {new_doc_name}: {str(e)}")
				continue
		
		doc.close()
		frappe.db.commit()
		return created_count
