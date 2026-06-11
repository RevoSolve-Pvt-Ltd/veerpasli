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
	},
	translate(frm) {
		const english = frm.doc.location_english;
		const gujarati = frm.doc.location_gujarati;
		
		if (english && !gujarati) {
			// Translate English to Gujarati
			frappe.call({
				method: "veerpasli.veerpasli.doctype.veerpasli_pdf.veerpasli_pdf.translate_location",
				args: {
					text: english,
					source_lang: "en",
					target_lang: "gu"
				},
				freeze: true,
				freeze_message: __("Translating English to Gujarati..."),
				callback: function(r) {
					if (r.message) {
						frm.set_value("location_gujarati", r.message);
					} else {
						frappe.show_alert({
							message: __("Translation failed or returned empty."),
							indicator: "orange"
						});
					}
				}
			});
		} else if (gujarati && !english) {
			// Translate Gujarati to English
			frappe.call({
				method: "veerpasli.veerpasli.doctype.veerpasli_pdf.veerpasli_pdf.translate_location",
				args: {
					text: gujarati,
					source_lang: "gu",
					target_lang: "en"
				},
				freeze: true,
				freeze_message: __("Translating Gujarati to English..."),
				callback: function(r) {
					if (r.message) {
						frm.set_value("location_english", r.message);
					} else {
						frappe.show_alert({
							message: __("Translation failed or returned empty."),
							indicator: "orange"
						});
					}
				}
			});
		} else if (english && gujarati) {
			// Translate English to Gujarati (updating)
			frappe.call({
				method: "veerpasli.veerpasli.doctype.veerpasli_pdf.veerpasli_pdf.translate_location",
				args: {
					text: english,
					source_lang: "en",
					target_lang: "gu"
				},
				freeze: true,
				freeze_message: __("Updating translation..."),
				callback: function(r) {
					if (r.message) {
						frm.set_value("location_gujarati", r.message);
					} else {
						frappe.show_alert({
							message: __("Translation failed or returned empty."),
							indicator: "orange"
						});
					}
				}
			});
		} else {
			frappe.msgprint(__("Please enter either English Location or Gujarati Location first."));
		}
	}
});
