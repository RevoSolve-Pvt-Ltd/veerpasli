import frappe

def get_website_user_home_page(user):
	if user and user != "Guest":
		is_collector = frappe.db.get_value("Person", {"user": user, "is_collector": "true"}, "name")
		if is_collector:
			return "donations"
	return None
