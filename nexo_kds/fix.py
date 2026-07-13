import frappe

def main():
    doctypes = ["KDS Station", "Kitchen Order Ticket", "Kitchen Order Item"]
    for dt in doctypes:
        doc = frappe.get_doc("DocType", dt)
        doc.custom = 0
        doc.module = "Nexo Kds"
        doc.save(ignore_permissions=True)
    frappe.db.commit()
