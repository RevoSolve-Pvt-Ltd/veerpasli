# Copyright (c) 2026, Ankit and contributors
# For license information, please see license.txt

import frappe
import re
from frappe.model.document import Document


class Person(Document):
	def autoname(self):
		fullname = (self.gujarati_fullname or "").strip()
		village = (self.village_gujarati_name or "").strip()
		self.name = f"{fullname} - {village}"

	def validate(self):
		if self.is_collector == "true":
			if not self.collector_locations:
				frappe.throw("Collector Locations is mandatory for a Collector.")
			
			# Auto create/link user for collector
			create_user_for_collector(self)
		else:
			self.set("collector_locations", [])
			
			# Disable user if they are no longer a collector
			if self.user:
				disable_user_for_non_collector(self)


def get_clean_mobile_number(mobile_number):
	if not mobile_number:
		return None
	digits = re.sub(r'\D', '', str(mobile_number))
	if len(digits) >= 10:
		return digits[-10:]
	return None


def create_user_for_collector(person):
	clean_mobile = get_clean_mobile_number(person.mobile_number)
	if not clean_mobile:
		return

	email = f"{clean_mobile}@veerpasli.org"
	username = clean_mobile

	# Ensure system settings allow logging in by username
	system_settings = frappe.get_doc("System Settings")
	if not system_settings.allow_login_using_user_name:
		system_settings.allow_login_using_user_name = 1
		system_settings.save(ignore_permissions=True)

	if not person.user:
		# Check if user already exists by email or username
		if frappe.db.exists("User", email):
			person.user = email
			enable_user_if_disabled(email)
		elif frappe.db.exists("User", {"username": username}):
			user_email = frappe.db.get_value("User", {"username": username}, "name")
			person.user = user_email
			enable_user_if_disabled(user_email)
		else:
			# Create new User
			user_doc = frappe.get_doc({
				"doctype": "User",
				"email": email,
				"username": username,
				"first_name": person.english_fullname or person.gujarati_fullname or "Collector",
				"enabled": 1,
				"send_welcome_email": 0
			})
			user_doc.new_password = f"{clean_mobile}@123"
			if frappe.db.exists("Role", "Website User"):
				user_doc.append("roles", {
					"role": "Website User"
				})
			user_doc.insert(ignore_permissions=True)
			person.user = user_doc.name
	else:
		# If user is already linked, ensure it is enabled and handle mobile number updates
		enable_user_if_disabled(person.user)
		
		if frappe.db.exists("User", person.user):
			user_doc = frappe.get_doc("User", person.user)
			if user_doc.username != clean_mobile:
				new_email = f"{clean_mobile}@veerpasli.org"
				# Only rename if the new username/email is not already taken
				if not frappe.db.exists("User", new_email) and not frappe.db.exists("User", {"username": username}):
					frappe.rename_doc("User", person.user, new_email, force=True)
					person.user = new_email
					
					# Load and update username and first name
					updated_user = frappe.get_doc("User", new_email)
					updated_user.username = clean_mobile
					updated_user.first_name = person.english_fullname or person.gujarati_fullname or "Collector"
					updated_user.save(ignore_permissions=True)


def disable_user_for_non_collector(person):
	if person.user and frappe.db.exists("User", person.user):
		user_doc = frappe.get_doc("User", person.user)
		if user_doc.enabled:
			user_doc.enabled = 0
			user_doc.save(ignore_permissions=True)


def enable_user_if_disabled(email):
	if email and frappe.db.exists("User", email):
		user_doc = frappe.get_doc("User", email)
		if not user_doc.enabled:
			user_doc.enabled = 1
			user_doc.save(ignore_permissions=True)

