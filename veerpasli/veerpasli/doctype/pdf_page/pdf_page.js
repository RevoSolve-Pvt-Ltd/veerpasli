// Copyright (c) 2026, Ankit and contributors
// For license information, please see license.txt

frappe.ui.form.on("Pdf page", {
	refresh(frm) {
		if (frm.doc.page_file) {
			if(frm.doc.status == 'pending') {
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
			}

			if (['completed', 'verified'].includes(frm.doc.status)) {
				frm.add_custom_button(__('Open OCR Checker'), function() {
					frappe.set_route('ocr-checker', frm.doc.name);
				});
			}
		}
	},
});
