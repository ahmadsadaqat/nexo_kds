# Copyright (c) 2026, NEXO 4 ERP and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from nexo_kds.api import update_table_status


class TestKitchenOrderTicket(FrappeTestCase):
	def setUp(self):
		super().setUp()
		# Create a test table if not exists
		if not frappe.db.exists("Table", "Test Table 99"):
			table = frappe.get_doc({
				"doctype": "Table",
				"table_name": "Test Table 99",
				"status": "Available"
			})
			table.insert(ignore_permissions=True)
		else:
			frappe.db.set_value("Table", "Test Table 99", "status", "Available")
			
	def tearDown(self):
		if frappe.db.exists("Table", "Test Table 99"):
			frappe.delete_doc("Table", "Test Table 99", ignore_permissions=True)
		super().tearDown()

	def test_table_occupied_on_draft_invoice(self):
		# Create a draft POS Invoice with the table
		# Normally, when a POS Invoice is created or updated, update_table_status is triggered.
		customers = frappe.get_all("Customer", limit=1)
		companies = frappe.get_all("Company", limit=1)
		items = frappe.get_all("Item", limit=1)
		
		if not customers or not companies or not items:
			return  # skip test if base master data is missing
			
		doc = frappe.get_doc({
			"doctype": "POS Invoice",
			"customer": customers[0].name,
			"posa_table_no": "Test Table 99",
			"company": companies[0].name,
			"items": [
				{
					"item_code": items[0].name,
					"qty": 1,
					"rate": 10
				}
			]
		})
		doc.insert(ignore_permissions=True)
		
		# Since it's draft (docstatus=0), the table status should be "Occupied"
		# Let's call the update status function
		update_table_status(doc)
		status = frappe.db.get_value("Table", "Test Table 99", "status")
		self.assertEqual(status, "Occupied")
		
		# Now submit the POS Invoice (docstatus=1)
		doc.docstatus = 1
		update_table_status(doc)
		status = frappe.db.get_value("Table", "Test Table 99", "status")
		self.assertEqual(status, "Available")
