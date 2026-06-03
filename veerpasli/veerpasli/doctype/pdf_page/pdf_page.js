// Copyright (c) 2026, Ankit and contributors
// For license information, please see license.txt

frappe.ui.form.on("Pdf page", {
	refresh(frm) {
		if (frm.doc.page_file) {
			frm.add_custom_button(__('Process Image'), function() {
				frm.call({
					method: "trigger_process_image",
					doc: frm.doc,
					callback: function(r) {
						if (!r.exc) {
							frappe.show_alert({
								message: __('Image processing job scheduled'),
								indicator: 'green'
							});
						}
					}
				});
			});

			if (frm.doc.json_file) {
				frm.add_custom_button(__('Open OCR Checker'), function() {
					var image_url = frm.doc.page_file;
					var json_url = frm.doc.json_file;
					var ocr_route = '/app/ocr-checker?image=' + encodeURIComponent(image_url) + '&json=' + encodeURIComponent(json_url);
					window.open(ocr_route, '_blank');
				});
			}
		}
	},
});
