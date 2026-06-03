# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import os
import re
import pymupdf as fitz
from veerpasli.veerpasli.utils.pdf_splitter import normalize_location

class VeerpasliPDF(Document):
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

		file_path = frappe.get_site_path(self.document_pdf.lstrip('/'))
		if not os.path.exists(file_path):
			frappe.throw(f"File not found at {file_path}")

		with open(file_path, 'rb') as f:
			file_bytes = f.read()

		location = normalize_location(self.location)
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
				"is_private": 1
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
