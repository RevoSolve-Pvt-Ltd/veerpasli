// Copyright (c) 2026, Ankit and contributors
// For license information, please see license.txt

frappe.listview_settings["Donation"] = {
	// ── Runs once when the list view first loads ──────────────────────────────
	onload(listview) {
		// Inject a sticky total bar right below the list rows
		let $bar = $(`
			<div class="donation-total-bar" style="
				display: flex;
				align-items: center;
				justify-content: flex-end;
				gap: 12px;
				padding: 10px 20px;
				background: linear-gradient(90deg, #f8f9ff 0%, #eef2ff 100%);
				border-top: 2px solid #d0d9ff;
				border-bottom: 1px solid #e0e6ff;
				font-family: inherit;
			">
				<span style="color:#6c757d; font-size:13px; font-weight:500;">
					${__("Total")}
				</span>
				<span class="donation-total-value" style="
					font-size: 17px;
					font-weight: 700;
					color: #000;
					background: #fff;
					padding: 3px 18px;
					border-radius: 20px;
					border: 1.5px solid #b8cbff;
					min-width: 90px;
					text-align: center;
					letter-spacing: 0.5px;
				">—</span>
				<span class="donation-total-count" style="
					color: #adb5bd;
					font-size: 12px;
				"></span>
			</div>
		`);

		// Insert right after the list results area, before the paging controls
		listview.$frappe_list.after($bar);
		listview.$donation_total_bar = $bar;
	},

	// ── Runs every time the list is refreshed (filter change, page change …) ──
	refresh(listview) {
		if (!listview.$donation_total_bar) return;

		// Show loading state while fetching
		listview.$donation_total_bar.find(".donation-total-value").text("…");
		listview.$donation_total_bar.find(".donation-total-count").text("");

		// Collect current active filters from the list view
		let filters = [];
		try {
			filters = listview.filter_area ? listview.filter_area.get() : (listview.filters || []);
		} catch (e) {
			filters = [];
		}

		frappe.call({
			method: "veerpasli.veerpasli.doctype.donation.donation.get_donation_total",
			args: { filters: JSON.stringify(filters) },
			freeze: false,
			callback(r) {
				if (!r || !r.message) return;
				let total = r.message.total || 0;
				let count = r.message.count || 0;

				listview.$donation_total_bar
					.find(".donation-total-value")
					.text(Number(total).toLocaleString('en-IN'));

				listview.$donation_total_bar
					.find(".donation-total-count")
					.text(`(${count} ${__("records")})`);
			},
		});
	},

	// ── Colour-coded status badges per row ────────────────────────────────────
	get_indicator(doc) {
		if (doc.amount_english >= 10000) {
			return [__("High Value"), "green", "amount_english,>=,10000"];
		} else if (doc.amount_english > 0) {
			return [__("Donated"), "blue", "amount_english,>,0"];
		}
		return [__("Pending"), "orange", "amount_english,=,0"];
	},
};
