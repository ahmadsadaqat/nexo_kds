import frappe
from frappe.database.schema import DBTable

def sync_kds_schema():
    doctypes = ["KDS Station", "Kitchen Order Item", "Kitchen Order Ticket"]
    for dt in doctypes:
        try:
            doc = frappe.get_doc("DocType", dt)
            db_table = DBTable(doc)
            db_table.validate()
            db_table.sync()
            frappe.db.commit()
            print(f"Synced: {dt}")
        except Exception as e:
            print(f"Error syncing {dt}: {e}")
