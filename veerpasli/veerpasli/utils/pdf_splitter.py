import frappe
import io
import re
import pymupdf as fitz  # PyMuPDF

@frappe.whitelist()
def split_pdf_and_create_records(file_content, file_name):
    # 1. Process the uploaded file content (base64)
    import base64
    file_bytes = base64.b64decode(file_content)
    
    # 2. Extract Year (4 digits)
    year_match = re.search(r'\d{4}', file_name)
    extracted_year = int(year_match.group()) if year_match else 2026
    
    # 3. Extract Page Range (e.g., "1-10")
    range_match = re.search(r'(\d+)-(\d+)', file_name)
    if range_match:
        start_page = int(range_match.group(1))
    else:
        start_page = 1
    
    prefix = "veerpasli"
    
    # 4. Open the PDF using PyMuPDF
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    total_pages = len(doc)
    
    created_count = 0
    
    # 5. Loop through each page
    for i in range(total_pages):
        page = doc[i]
        
        # Render page to image (PNG)
        # matrix=fitz.Matrix(2, 2) zooms 2x for better quality. Remove for default resolution.
        mat = fitz.Matrix(2, 2) 
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to bytes
        img_bytes = pix.tobytes("png")
        
        # Calculate actual page number
        current_page_num = start_page + i
        
        # Construct names with .png extension
        new_doc_name = f"{prefix}-{extracted_year}-{current_page_num}"
        new_file_name = f"{new_doc_name}.png"
        
        # 6. Create the File DocType for the image
        single_page_file = frappe.get_doc({
            "doctype": "File",
            "file_name": new_file_name,
            "content": img_bytes,
            "is_private": 1
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