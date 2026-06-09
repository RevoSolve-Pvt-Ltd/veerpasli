// Copyright (c) 2026, Ankit and contributors
// For license information, please see license.txt

frappe.ui.form.on("Donation", {
	refresh(frm) {
		// Hide the raw coordinate fields and image URL from the user UI
		frm.toggle_display(['ocr_image_url', 'ocr_box_x', 'ocr_box_y', 'ocr_box_w', 'ocr_box_h'], false);

		if (frm.doc.ocr_image_url && frm.doc.ocr_box_x != null) {
			let x = frm.doc.ocr_box_x;
			let y = frm.doc.ocr_box_y;
			let w = frm.doc.ocr_box_w;
			let h = frm.doc.ocr_box_h;
			
			// Convert fractional coordinates to percentages (0-100)
			let left = (x - (w / 2)) * 100;
			let top = (y - (h / 2)) * 100;
			let widthPct = w * 100;
			let heightPct = h * 100;
			
			let html = `
				<div class="ocr-validation-card" style="border: 1px solid #d1d8dd; border-radius: 8px; background: #fff; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 20px;">
					<div style="background: #f8f9fa; border-bottom: 1px solid #d1d8dd; padding: 10px 15px; font-weight: bold; display: flex; align-items: center; justify-content: space-between;">
						<span>Source Page Bounding Box</span>
						<span style="font-size: 11px; background: #28a745; color: #fff; padding: 2px 8px; border-radius: 12px; font-weight: normal;">Tagged Region</span>
					</div>
					<div class="ocr-validation-scroll" style="position: relative; max-height: 450px; overflow: auto; background: #eaecf0; padding: 10px; text-align: center;">
						<div style="position: relative; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.15); border-radius: 4px; overflow: hidden;">
							<img src="${frm.doc.ocr_image_url}" style="display: block; max-width: 1400px; height: auto;" />
							<div style="
								position: absolute;
								left: ${left}%;
								top: ${top}%;
								width: ${widthPct}%;
								height: ${heightPct}%;
								border: 3px solid #28a745;
								background: rgba(40, 167, 69, 0.15);
								box-shadow: 0 0 15px rgba(40, 167, 69, 0.6);
								border-radius: 2px;
								pointer-events: none;
							"></div>
						</div>
					</div>
				</div>
			`;
			
			let $wrapper = frm.fields_dict.ocr_preview.$wrapper;
			$wrapper.html(html);
			
			// Center box after image loads
			let img = $wrapper.find('img')[0];
			if (img) {
				let centerBox = function() {
					let imgWidth = img.clientWidth;
					let imgHeight = img.clientHeight;
					if (imgWidth === 0) return; // Not fully sized/rendered yet
					
					let boxLeftPx = (left / 100) * imgWidth;
					let boxTopPx = (top / 100) * imgHeight;
					let boxWidthPx = (widthPct / 100) * imgWidth;
					let boxHeightPx = (heightPct / 100) * imgHeight;
					
					let container = $wrapper.find('.ocr-validation-scroll')[0];
					if (container) {
						let scrollX = boxLeftPx + (boxWidthPx / 2) - (container.clientWidth / 2);
						let scrollY = boxTopPx + (boxHeightPx / 2) - (container.clientHeight / 2);
						container.scrollLeft = Math.max(0, scrollX);
						container.scrollTop = Math.max(0, scrollY);
					}
				};
				
				if (img.complete) {
					setTimeout(centerBox, 100);
				} else {
					img.onload = centerBox;
				}
			}
		} else {
			frm.fields_dict.ocr_preview.$wrapper.html(
				'<div class="text-muted" style="padding: 20px; border: 1px dashed #d1d8dd; border-radius: 8px; text-align: center; background: #fdfdfd;">No OCR validation metadata available for this donation.</div>'
			);
		}
	}
});
