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

		// Setup suggestions on English and Gujarati location fields
		setup_suggestions(frm, "location_english", "location_gujarati", "gu");
		setup_suggestions(frm, "location_gujarati", "location_english", "en");
	},
	location_english(frm) {
		if (!frm.doc.location_english && frm.doc.location_gujarati) {
			frm.set_value("location_gujarati", "");
		}
	},
	location_gujarati(frm) {
		if (!frm.doc.location_gujarati && frm.doc.location_english) {
			frm.set_value("location_english", "");
		}
	}
});

function debounce(func, wait) {
	let timeout;
	return function(...args) {
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(this, args), wait);
	};
}

function get_suggestions(text, lang) {
	return new Promise((resolve) => {
		if (lang === "gu") {
			const url = `https://inputtools.google.com/request?text=${encodeURIComponent(text)}&itc=gu-t-i0-und&num=13&cp=0&cs=1&ie=utf-8&oe=utf-8&app=jsapi`;
			fetch(url)
				.then(res => res.json())
				.then(data => {
					if (data && data[0] === "SUCCESS" && data[1] && data[1][0] && data[1][0][1]) {
						resolve(data[1][0][1]);
					} else {
						resolve([]);
					}
				})
				.catch(() => {
					frappe.call({
						method: "veerpasli.veerpasli.doctype.veerpasli_pdf.veerpasli_pdf.get_input_suggestions",
						args: { text: text, lang: "gu" },
						callback: function(r) {
							resolve(r.message || []);
						}
					});
				});
		} else {
			const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=gu&tl=en&dt=t&q=${encodeURIComponent(text)}`;
			fetch(url)
				.then(res => res.json())
				.then(data => {
					if (data && data[0] && data[0][0] && data[0][0][0]) {
						resolve([data[0][0][0].trim()]);
					} else {
						resolve([]);
					}
				})
				.catch(() => {
					frappe.call({
						method: "veerpasli.veerpasli.doctype.veerpasli_pdf.veerpasli_pdf.get_input_suggestions",
						args: { text: text, lang: "en" },
						callback: function(r) {
							resolve(r.message || []);
						}
					});
				});
		}
	});
}

function setup_suggestions(frm, source_field, target_field, lang) {
	const $input = frm.fields_dict[source_field].$input;
	if (!$input) return;

	let $suggestions = $input.parent().find('.location-suggestions');
	if (!$suggestions.length) {
		$suggestions = $('<div class="location-suggestions" style="position: absolute; z-index: 1000; background: #fff; border: 1px solid #d1d8dd; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 100%; max-height: 200px; overflow-y: auto; display: none; margin-top: 2px;"></div>');
		$input.parent().css('position', 'relative').append($suggestions);
	}

	const fetch_suggestions = debounce(function(val) {
		val = (val || '').trim();
		if (!val || val.length < 2) {
			$suggestions.hide();
			return;
		}

		get_suggestions(val, lang).then(list => {
			render_list(list);
		});
	}, 300);

	function render_list(list) {
		$suggestions.empty();
		if (list && list.length > 0) {
			list.forEach(item => {
				const $item = $(`<div style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f1f3f5; font-size: 13px; color: #212529; font-weight: 500; text-align: left;"></div>`).text(item);
				$item.on('mousedown', function(e) {
					e.preventDefault();
				});
				$item.on('click', function() {
					frm.set_value(target_field, item);
					$suggestions.hide();
				});
				$suggestions.append($item);
			});
			$suggestions.show();
		} else {
			$suggestions.hide();
		}
	}

	$input.on('input', function() {
		fetch_suggestions($(this).val());
	});

	$input.on('focus', function() {
		fetch_suggestions($(this).val());
	});

	$input.on('blur', function() {
		setTimeout(() => {
			$suggestions.hide();
		}, 200);
	});
}
