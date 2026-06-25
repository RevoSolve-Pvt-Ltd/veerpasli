"""
mobile_api.py  –  REST endpoints for the VeerPasli Collector mobile app.

All endpoints are decorated with @frappe.whitelist(allow_guest=True) for
login/logout, and @frappe.whitelist() (requires authentication) for everything
else.

Authentication flow
-------------------
1.  POST /api/method/veerpasli.mobile_api.login
        body: { "usr": "<mobile_number>", "pwd": "<password>" }
        returns: { "api_key": "...", "api_secret": "...", "collector": {...} }

2.  Every subsequent request must include the header:
        Authorization: token <api_key>:<api_secret>

3.  POST /api/method/veerpasli.mobile_api.logout
        (no body needed – the token from the header identifies the user)
        Revokes (deletes) the api_key / api_secret so the token is dead.
"""

import frappe
from frappe import _
from frappe.utils.password import update_password


# ---------------------------------------------------------------------------
# Helper
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
    """Generate (or regenerate) api_key + api_secret for the given user and return them."""
    user_doc = frappe.get_doc("User", user_email)

    # api_key is stable per user; regenerate api_secret every login for security
    if not user_doc.api_key:
        api_key = frappe.generate_hash(length=15)
        user_doc.api_key = api_key

    api_secret = frappe.generate_hash(length=15)
    # store hashed secret
    user_doc.api_secret = api_secret          # frappe hashes this on save
    user_doc.save(ignore_permissions=True)
    frappe.db.commit()
    return user_doc.api_key, api_secret       # return plain secret (only time it is visible)


def _get_collector_locations(collector_name):
    """Return list of locations with English name assigned to the collector."""
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
# 1. LOGIN
# ---------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def login(usr, pwd):
    """
    Authenticate with username (mobile number) or email + password.
    Returns api_key, api_secret, and collector profile.

    POST /api/method/veerpasli.mobile_api.login
    Body (form-data or JSON):
        usr  – mobile number (e.g. 9876543210) or email
        pwd  – password
    """
    # --- Frappe's built-in login check ---
    from frappe.auth import LoginManager
    login_manager = LoginManager()
    login_manager.authenticate(user=usr, pwd=pwd)
    login_manager.post_login()

    user_email = frappe.session.user
    if not user_email or user_email == "Guest":
        frappe.throw(_("Invalid credentials"), frappe.AuthenticationError)

    # --- Ensure the person is a collector ---
    collector = _get_collector_profile(user_email)

    # --- Issue API key / secret ---
    api_key, api_secret = _generate_keys(user_email)

    # --- Fetch collector's assigned locations ---
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


# ---------------------------------------------------------------------------
# 2. LOGOUT
# ---------------------------------------------------------------------------

@frappe.whitelist()
def logout():
    """
    Revoke the current API key + secret so the token is permanently dead.

    POST /api/method/veerpasli.mobile_api.logout
    Header: Authorization: token <api_key>:<api_secret>
    """
    user_email = frappe.session.user
    if not user_email or user_email == "Guest":
        frappe.throw(_("Not authenticated"), frappe.AuthenticationError)

    user_doc = frappe.get_doc("User", user_email)
    user_doc.api_key = ""
    user_doc.api_secret = ""
    user_doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"message": "Logged out successfully"}


# ---------------------------------------------------------------------------
# 3. GET COLLECTOR PROFILE
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_profile():
    """
    Return the logged-in collector's profile.

    GET /api/method/veerpasli.mobile_api.get_profile
    Header: Authorization: token <api_key>:<api_secret>
    """
    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    locations = _get_collector_locations(collector["name"])
    collector["locations"] = locations
    return collector


# ---------------------------------------------------------------------------
# 4. DASHBOARD – summary stats for the collector
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_dashboard():
    """
    Return total donations, total amount, and recent 5 donations for the collector.

    GET /api/method/veerpasli.mobile_api.get_dashboard
    """
    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)
    collector_name = collector["name"]

    all_donations = frappe.get_all(
        "Donation",
        filters={"collector": collector_name},
        fields=["name", "takti", "takti_english", "amount_gujarati",
                "amount_english", "donation_date", "location",
                "location_english", "village", "village_english",
                "docstatus", "creation"],
        order_by="creation desc",
        limit=0,
    )

    total_amount = sum((d.amount_english or 0) for d in all_donations)
    recent = all_donations[:5]

    return {
        "collector_name": collector_name,
        "total_donations": len(all_donations),
        "total_amount": total_amount,
        "recent_donations": recent,
    }


# ---------------------------------------------------------------------------
# 5. LIST DONATIONS (paginated, filterable)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_donations(page=1, page_size=20, location=None, start_date=None, end_date=None):
    """
    Return paginated list of donations created by this collector.

    GET /api/method/veerpasli.mobile_api.get_donations
    Params:
        page       – page number (default 1)
        page_size  – records per page (default 20, max 100)
        location   – filter by location name (optional)
        start_date – filter donations >= this date YYYY-MM-DD (optional)
        end_date   – filter donations <= this date YYYY-MM-DD (optional)
    """
    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    page = int(page)
    page_size = min(int(page_size), 100)
    offset = (page - 1) * page_size

    filters = {"collector": collector["name"]}
    if location:
        filters["location"] = location
    if start_date:
        filters["donation_date"] = [">=", start_date]
    if end_date:
        # if both dates given, use between
        if start_date:
            filters["donation_date"] = ["between", [start_date, end_date]]
        else:
            filters["donation_date"] = ["<=", end_date]

    donations = frappe.get_all(
        "Donation",
        filters=filters,
        fields=["name", "takti", "takti_english", "amount_gujarati",
                "amount_english", "donation_date", "location",
                "location_english", "village", "village_english", "docstatus"],
        order_by="creation desc",
        limit=page_size,
        limit_start=offset,
    )

    total = frappe.db.count("Donation", filters=filters)

    # Calculate overall total collected amount and total donors across all matching donations
    matching_donations = frappe.get_all("Donation", filters=filters, fields=["name", "takti", "amount_english"])
    
    total_collected_amount = sum((d.get("amount_english") or 0) for d in matching_donations)

    total_donors = 0
    matching_donation_names = [d["name"] for d in matching_donations]
    if matching_donation_names:
        # Get all unique main donors (taktis)
        taktis = {d["takti"] for d in matching_donations if d.get("takti")}
        
        # Get all unique child table donors
        child_donors = {
            d["donor_name"] 
            for d in frappe.get_all("Donor", filters={"parent": ["in", matching_donation_names]}, fields=["donor_name"])
            if d.get("donor_name")
        }
        
        # Unique union of both sets
        total_donors = len(taktis.union(child_donors))

    return {
        "data": donations,
        "total": total,
        "total_collected_amount": total_collected_amount,
        "total_donors": total_donors,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),  # ceiling division
    }


# ---------------------------------------------------------------------------
# 6. GET SINGLE DONATION (with donors child table)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_donation(name):
    """
    Return full detail of a single Donation including donors list.

    GET /api/method/veerpasli.mobile_api.get_donation?name=DON-0001
    """
    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    donation = frappe.get_doc("Donation", name)

    # Security: only the collector who created it can view it
    if donation.collector != collector["name"]:
        frappe.throw(_("Not permitted to view this donation"), frappe.PermissionError)

    donors = [
        {
            "donor_name": d.donor_name,
            "donor_name_english": d.donor_name_english,
            "amount": d.amount,
        }
        for d in donation.list_of_donors
    ]

    total_collected_amount = sum((d.amount or 0) for d in donation.list_of_donors)
    total_donors = len(donation.list_of_donors)

    return {
        "name": donation.name,
        "takti": donation.takti,
        "takti_english": donation.takti_english,
        "amount_gujarati": donation.amount_gujarati,
        "amount_english": donation.amount_english,
        "donation_date": str(donation.donation_date) if donation.donation_date else None,
        "village": donation.village,
        "village_english": donation.village_english,
        "location": donation.location,
        "location_english": donation.location_english,
        "collector": donation.collector,
        "collector_english": donation.collector_english,
        "docstatus": donation.docstatus,
        "list_of_donors": donors,
        "total_collected_amount": total_collected_amount,
        "total_donors": total_donors,
    }


# ---------------------------------------------------------------------------
# 7. CREATE DONATION
# ---------------------------------------------------------------------------

@frappe.whitelist()
def create_donation(
    takti,
    amount_gujarati,
    location,
    amount_english=None,
    donation_date=None,
    village=None,
    list_of_donors=None,
):
    """
    Create a new Donation record for this collector.

    POST /api/method/veerpasli.mobile_api.create_donation
    Body (JSON):
    {
        "takti": "Person name",
        "amount_gujarati": "૧૦૦",
        "location": "Location name",
        "amount_english": 100,                  // optional
        "donation_date": "2026-06-24",          // optional, defaults to today
        "village": "Village name",              // optional
        "list_of_donors": [                     // optional
            { "donor_name": "Person name", "amount": 50 }
        ]
    }
    """
    import json

    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    if isinstance(list_of_donors, str):
        list_of_donors = json.loads(list_of_donors)

    doc = frappe.get_doc({
        "doctype": "Donation",
        "takti": takti,
        "amount_gujarati": amount_gujarati,
        "amount_english": amount_english,
        "location": location,
        "village": village,
        "collector": collector["name"],
        "donation_date": donation_date or frappe.utils.today(),
    })

    if list_of_donors:
        for donor in list_of_donors:
            doc.append("list_of_donors", {
                "donor_name": donor.get("donor_name"),
                "amount": donor.get("amount"),
            })

    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "message": "Donation created successfully",
        "name": doc.name,
    }


# ---------------------------------------------------------------------------
# 8. UPDATE DONATION
# ---------------------------------------------------------------------------

@frappe.whitelist()
def update_donation(name, **kwargs):
    """
    Update an existing draft Donation.

    POST /api/method/veerpasli.mobile_api.update_donation
    Body (JSON):
    {
        "name": "DON-0001",
        "amount_gujarati": "૨૦૦",
        "amount_english": 200,
        "list_of_donors": [...]      // replaces entire child table
    }
    """
    import json

    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    donation = frappe.get_doc("Donation", name)
    if donation.collector != collector["name"]:
        frappe.throw(_("Not permitted to edit this donation"), frappe.PermissionError)
    if donation.docstatus == 1:
        frappe.throw(_("Cannot edit a submitted donation"))

    allowed_fields = ["takti", "amount_gujarati", "amount_english",
                      "location", "village", "donation_date"]
    for field in allowed_fields:
        if field in kwargs and kwargs[field] is not None:
            donation.set(field, kwargs[field])

    list_of_donors = kwargs.get("list_of_donors")
    if list_of_donors is not None:
        if isinstance(list_of_donors, str):
            list_of_donors = json.loads(list_of_donors)
        donation.set("list_of_donors", [])
        for donor in list_of_donors:
            donation.append("list_of_donors", {
                "donor_name": donor.get("donor_name"),
                "amount": donor.get("amount"),
            })

    donation.save(ignore_permissions=True)
    frappe.db.commit()

    return {"message": "Donation updated successfully", "name": donation.name}


# ---------------------------------------------------------------------------
# 9. SUBMIT DONATION
# ---------------------------------------------------------------------------

@frappe.whitelist()
def submit_donation(name):
    """
    Submit (finalise) a Donation so it becomes read-only.

    POST /api/method/veerpasli.mobile_api.submit_donation
    Body: { "name": "DON-0001" }
    """
    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    donation = frappe.get_doc("Donation", name)
    if donation.collector != collector["name"]:
        frappe.throw(_("Not permitted to submit this donation"), frappe.PermissionError)

    donation.submit()
    frappe.db.commit()

    return {"message": "Donation submitted successfully", "name": donation.name}


# ---------------------------------------------------------------------------
# 10. DOWNLOAD PDF
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_donation_pdf(name, print_format="Standard"):
    """
    Return a base64-encoded PDF of the donation receipt.

    GET /api/method/veerpasli.mobile_api.get_donation_pdf?name=DON-0001
    Optional: &print_format=Standard

    The mobile app can decode the base64 string and save / open the PDF.
    """
    import base64
    from frappe.utils.pdf import get_pdf

    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    donation = frappe.get_doc("Donation", name)
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
# 11. HELPER – List Locations (for dropdown in Create Donation screen)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_locations():
    """
    Return only the locations assigned to the logged-in collector
    (from their collector_locations child table on the Person doctype).

    GET /api/method/veerpasli.mobile_api.get_locations
    """
    user_email = frappe.session.user
    collector = _get_collector_profile(user_email)

    return _get_collector_locations(collector["name"])


# ---------------------------------------------------------------------------
# 12. HELPER – List Persons (takti / donor picker)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_persons(search=None, limit=30):
    """
    Return Persons matching a search string (for takti / donor autocomplete).

    GET /api/method/veerpasli.mobile_api.get_persons?search=<query>
    """
    kwargs = dict(
        fields=["name", "gujarati_fullname", "english_fullname",
                "village_gujarati_name", "village_english_name"],
        limit=int(limit),
        order_by="gujarati_fullname asc",
    )

    if search:
        kwargs["or_filters"] = [
            ["gujarati_fullname", "like", f"%{search}%"],
            ["english_fullname", "like", f"%{search}%"],
        ]

    return frappe.get_all("Person", **kwargs)


# ---------------------------------------------------------------------------
# 13. HELPER – List Villages (for dropdown)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_villages():
    """
    Return all Villages.

    GET /api/method/veerpasli.mobile_api.get_villages
    """
    return frappe.get_all(
        "Village",
        fields=["name", "gujarati_name", "english_name"],
        order_by="gujarati_name asc",
    )
