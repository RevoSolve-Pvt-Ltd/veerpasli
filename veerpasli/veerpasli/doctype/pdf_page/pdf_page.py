# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import subprocess
import os

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
				doc.db_set('json_file', file_doc.file_url)

			doc.db_set("status", "completed")
		else:
			doc.db_set("status", "failed")
	except Exception:
		doc.db_set("status", "failed")
	finally:
		frappe.db.commit()
