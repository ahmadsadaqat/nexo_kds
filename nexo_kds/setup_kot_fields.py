import frappe

def create_kot_custom_fields():
    custom_fields = {
        "POS Profile": [
            {
                "fieldname": "posa_enable_kot",
                "label": "Enable KOT (Kitchen Order Ticket)",
                "fieldtype": "Check",
                "insert_after": "posa_restaurant_tables",
                "default": "0"
            }
        ],
        "Item": [
            {
                "fieldname": "custom_kds_station",
                "label": "KDS Station",
                "fieldtype": "Link",
                "options": "KDS Station",
                "insert_after": "item_group",
                "description": "Select the KDS Station where this item should be prepared (used by Nexo KDS)."
            }
        ]
    }

    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
    create_custom_fields(custom_fields, ignore_validate=True)

    # Ensure KDS User Role exists
    if not frappe.db.exists("Role", "KDS User"):
        role = frappe.new_doc("Role")
        role.role_name = "KDS User"
        role.desk_access = 1
        role.insert(ignore_permissions=True)
        print("Role 'KDS User' created successfully.")

    frappe.db.commit()
    print("Custom fields created successfully.")
