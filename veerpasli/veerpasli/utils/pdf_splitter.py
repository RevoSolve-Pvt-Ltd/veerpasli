import frappe
import io
import re
import os
import pymupdf as fitz  # PyMuPDF


def normalize_location(location):
    location = location.strip()
    location = re.sub(r'[ _]+', '-', location)
    location = re.sub(r'[^A-Za-z0-9\-\(\)]', '-', location)
    location = re.sub(r'-{2,}', '-', location)
    return location.strip('-') or 'unknown'


def get_file_path(file_url):
    if not file_url:
        return None
    if os.path.isabs(file_url) and not file_url.startswith("/files/") and not file_url.startswith("/private/files/"):
        return file_url

    url = file_url
    if not url.startswith("/"):
        url = "/" + url

    if url.startswith("/private/files/"):
        return frappe.get_site_path("private", "files", url.split("/private/files/", 1)[1])
    elif url.startswith("/files/"):
        return frappe.get_site_path("public", "files", url.split("/files/", 1)[1])
    return frappe.get_site_path(file_url.lstrip('/'))


def parse_pdf_metadata(file_name):
    base_name = os.path.splitext(os.path.basename(file_name))[0]
    normalized = re.sub(r'[_]+', '-', base_name)

    location = 'unknown'
    year = None
    start_page = 1

    # Try to parse veerpasli-location-year-range
    match = re.match(r'^veerpasli-([^\d]+)-(?P<year>\d{4})-(?P<range>\d+-\d+)$', normalized, re.IGNORECASE)
    if match:
        location = normalize_location(match.group(1))
        year = int(match.group('year'))
        range_match = re.match(r'(?P<start>\d+)-(?P<end>\d+)', match.group('range'))
        if range_match:
            start_page = int(range_match.group('start'))
    else:
        # Fallback to veerpasli-year-range or other formats
        year_match = re.search(r'(\d{4})', normalized)
        if year_match:
            year = int(year_match.group(1))
        range_match = re.search(r'(\d+)-(\d+)', normalized)
        if range_match:
            start_page = int(range_match.group(1))

        # If no explicit location found, use any text between veerpasli and year
        fallback_match = re.match(r'^veerpasli-([^\d]+)-\d{4}-\d+-\d+$', normalized, re.IGNORECASE)
        if fallback_match:
            location = normalize_location(fallback_match.group(1))
        elif normalized.lower().startswith('veerpasli-'):
            remainder = normalized[len('veerpasli-'):]
            location = normalize_location(re.sub(r'\d{4}.*$', '', remainder))

    if year is None:
        year = 2026

    return location or 'unknown', year, start_page


@frappe.whitelist()
def split_pdf_and_create_records(file_content, file_name):
    # 1. Process the uploaded file content (base64)
    import base64
    file_bytes = base64.b64decode(file_content)
    
    # 2. Extract metadata from the uploaded pdf filename
    location, extracted_year, start_page = parse_pdf_metadata(file_name)
    prefix = 'veerpasli'
    
    # 3. Open the PDF using PyMuPDF
    doc = fitz.open(stream=file_bytes, filetype='pdf')
    total_pages = len(doc)
    
    created_count = 0
    
    # 4. Loop through each page
    for i in range(total_pages):
        page = doc[i]
        
        # Render page to image (PNG)
        # matrix=fitz.Matrix(2, 2) zooms 2x for better quality. Remove for default resolution.
        mat = fitz.Matrix(2, 2)
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to bytes
        img_bytes = pix.tobytes('png')
        
        # Calculate actual page number
        current_page_num = start_page + i
        
        # Construct names with .png extension
        new_doc_name = f"{prefix}-{location}-{extracted_year}-{current_page_num}"
        new_file_name = f"{new_doc_name}.png"
        
        # 6. Create the File DocType for the image
        single_page_file = frappe.get_doc({
            "doctype": "File",
            "file_name": new_file_name,
            "content": img_bytes,
            "is_private": 0
        })
        single_page_file.save()
        
        # 7. Create the "Pdf page" Record
        try:
            if not frappe.db.exists("Pdf page", new_doc_name):
                page_doc = frappe.get_doc({
                    "doctype": "Pdf page",
                    "name": new_doc_name,
                    "page_number": current_page_num,
                    "page_file": single_page_file.file_url, # This will now be an image URL
                    "year": extracted_year,
                })
                page_doc.insert()
                created_count += 1
            else:
                frappe.log_error(f"Skipped {new_doc_name}: Already exists")
        except Exception as e:
            frappe.log_error(f"Error creating {new_doc_name}: {str(e)}")
            continue
    
    doc.close()
    frappe.db.commit()
    return created_count   