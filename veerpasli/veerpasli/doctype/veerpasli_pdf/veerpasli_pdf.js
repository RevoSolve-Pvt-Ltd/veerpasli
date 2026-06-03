// Copyright (c) 2026, Ankit and contributors
// For license information, please see license.txt

frappe.ui.form.on("Veerpasli PDF", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("Send to OCR"), function() {
				frm.call({
					doc: frm.doc,
					method: "send_to_ocr",
					freeze: true,
					freeze_message: __("Splitting PDF and sending to OCR..."),
					callback: function(r) {
						if (!r.exc) {
							frappe.show_alert({
								message: __("Successfully split PDF and created {0} page records.", [r.message]),
								indicator: "green"
							});
						}
					}
				});
			});
		}
	}
});
