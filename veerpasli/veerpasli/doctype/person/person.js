// Copyright (c) 2026, Ankit and contributors
// For license information, please see license.txt

frappe.ui.form.on("Person", {
	refresh(frm) {
		// Hide the standard child table grid to keep the UI clean
		if (frm.fields_dict.tagged_boxes) {
			frm.fields_dict.tagged_boxes.grid.wrapper.hide();
		}

		if (frm.doc.tagged_boxes && frm.doc.tagged_boxes.length > 0) {
			let boxes = frm.doc.tagged_boxes;
			
			// Build the HTML structure: a premium full-width card with top tabs/pills
			let html = `
				<div class="ocr-person-validation-card" style="border: 1px solid #d1d8dd; border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 20px;">
					<!-- Header / Tabs bar -->
					<div style="background: #f8f9fa; border-bottom: 1px solid #d1d8dd; padding: 12px 15px;">
						<div style="font-weight: bold; font-size: 14px; color: #495057; margin-bottom: 10px;">
							Source Validation Pages (${boxes.length})
						</div>
						<div class="ocr-box-tabs" style="display: flex; flex-wrap: wrap; gap: 8px;">
							${boxes.map((box, idx) => {
								let refType = box.reference_doctype || 'Source';
								let refName = box.reference_name || 'OCR Box';
								let label = `${refType}: ${refName}`;
								if (refType === 'Collector') {
									let parts = refName.split(':');
									label = `Collector: ${parts[1] || parts[0]}`;
								}
								let activeStyle = idx === 0 
									? 'background-color: #28a745; color: #fff; border-color: #28a745;' 
									: 'background-color: #fff; color: #495057; border-color: #ced4da;';
								return `
									<button type="button" class="btn btn-sm ocr-person-tab-btn" data-index="${idx}" style="border: 1px solid; border-radius: 20px; padding: 5px 15px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; ${activeStyle}">
										${label}
									</button>
								`;
							}).join('')}
						</div>
					</div>
					
					<!-- Preview Display -->
					<div class="ocr-box-preview-container" style="background: #eaecf0; position: relative; max-height: 500px; display: flex; flex-direction: column;">
						<div class="ocr-preview-header" style="background: #fff; border-bottom: 1px solid #d1d8dd; padding: 10px 15px; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: space-between;">
							<span id="ocr-active-label" style="color: #495057;">Loading...</span>
							<span style="font-size: 11px; background: #28a745; color: #fff; padding: 2px 8px; border-radius: 12px; font-weight: normal;">Green box indicates tagged region</span>
						</div>
						<div class="ocr-preview-scroll-viewport" style="position: relative; overflow: auto; height: 450px; padding: 15px; text-align: center;">
							<div id="ocr-preview-wrapper" style="position: relative; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.15); border-radius: 4px; overflow: hidden;">
								<!-- Dynamic Image and Overlay gets injected here -->
							</div>
						</div>
					</div>
				</div>
			`;
			
			let $wrapper = frm.fields_dict.ocr_preview.$wrapper;
			$wrapper.html(html);
			
			// Handle switching active box
			let selectBox = function(idx) {
				let box = boxes[idx];
				if (!box) return;
				
				// Update tab button styles
				$wrapper.find('.ocr-person-tab-btn').each(function() {
					let itemIndex = $(this).attr('data-index');
					if (parseInt(itemIndex) === idx) {
						$(this).attr('style', 'border: 1px solid; border-radius: 20px; padding: 5px 15px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; background-color: #28a745; color: #fff; border-color: #28a745;');
					} else {
						$(this).attr('style', 'border: 1px solid; border-radius: 20px; padding: 5px 15px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; background-color: #fff; color: #495057; border-color: #ced4da;');
					}
				});
				
				// Update label
				let refType = box.reference_doctype || 'Source';
				let refName = box.reference_name || 'OCR Box';
				let label = `${refType}: ${refName}`;
				if (refType === 'Collector') {
					let parts = refName.split(':');
					label = `Collector in ${parts[1] || parts[0]}`;
				}
				$wrapper.find('#ocr-active-label').text(label);
				
				// Convert fractional coordinates to percentages (0-100)
				let x = box.center_x;
				let y = box.center_y;
				let w = box.width;
				let h = box.height;
				
				let left = (x - (w / 2)) * 100;
				let top = (y - (h / 2)) * 100;
				let widthPct = w * 100;
				let heightPct = h * 100;
				
				// Inject image and box overlay
				let previewHtml = `
					<img src="${box.image_url}" style="display: block; max-width: 1400px; height: auto;" />
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
				`;
				
				let $previewWrapper = $wrapper.find('#ocr-preview-wrapper');
				$previewWrapper.html(previewHtml);
				
				// Auto-scroll to center the bounding box
				let img = $previewWrapper.find('img')[0];
				if (img) {
					let centerBox = function() {
						let imgWidth = img.clientWidth;
						let imgHeight = img.clientHeight;
						if (imgWidth === 0) return;
						
						let boxLeftPx = (left / 100) * imgWidth;
						let boxTopPx = (top / 100) * imgHeight;
						let boxWidthPx = (widthPct / 100) * imgWidth;
						let boxHeightPx = (heightPct / 100) * imgHeight;
						
						let container = $wrapper.find('.ocr-preview-scroll-viewport')[0];
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
			};
			
			// Initialize with the first box
			selectBox(0);
			
			// Bind click handlers to tab buttons
			$wrapper.on('click', '.ocr-person-tab-btn', function() {
				let idx = parseInt($(this).attr('data-index'));
				selectBox(idx);
			});
			
		} else {
			frm.fields_dict.ocr_preview.$wrapper.html(
				'<div class="text-muted" style="padding: 20px; border: 1px dashed #d1d8dd; border-radius: 8px; text-align: center; background: #fdfdfd;">No OCR validation images available for this person.</div>'
			);
		}
	}
});
