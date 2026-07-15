import frappe
from frappe import _

# Updated to match your specific DocType name
CHILD_DOCTYPE = "Kitchen Order Item"

@frappe.whitelist(allow_guest=True)
def login_kds_user(username, password):
    try:
        user = frappe.db.get_value("User", {"name": username}, "name")
        if not user or not frappe.utils.password.check_password(user, password):
            return {"success": False, "message": "Invalid username or password"}
        frappe.set_user(user)
        return {"success": True, "message": "Login successful"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@frappe.whitelist(allow_guest=True)
def get_kds_initial_context():
    try:
        user = frappe.session.user
        if not user or user == "Guest":
            return {"error": True, "is_guest": True}
        branch = frappe.db.get_value("Employee", {"user_id": user}, "branch")
        # Don't assume a default branch; if employee has no branch, return no stations
        branch_name = branch

        stations = []
        if branch_name:
            stations = frappe.get_all(
                "KDS Station",
                filters={"is_active": 1, "branch": branch_name},
                pluck="name",
            )

        return {"error": False, "user": user, "branch": branch_name, "stations": stations}
    except Exception as e:
        return {"error": True, "message": str(e)}

@frappe.whitelist()
def get_station_items_count(branch, station_name):
    try:
        valid_kot_names = frappe.get_all("Kitchen Order Ticket", 
            filters={"branch": branch, "docstatus": 0}, pluck="name")
        
        filters = {"parent": ["in", valid_kot_names]}
        if station_name == "Assembly":
            filters["status"] = "Ready"
        else:
            filters["kds"] = station_name
            filters["status"] = ["in", ["Pending", "Preparing"]]
        
        count = frappe.db.count(CHILD_DOCTYPE, filters=filters)
        return {"count": count}
    except Exception as e:
        return {"count": 0, "error": str(e)}

@frappe.whitelist()
def get_kds_items(branch, station_name):
    try:
        # 1. Get all active KOTs for the branch
        valid_kot_names = frappe.get_all("Kitchen Order Ticket", 
            filters={"branch": branch, "docstatus": 0}, pluck="name")
        
        if not valid_kot_names:
            return []
        
        # 2. Filter items based on Station
        if station_name == "Assembly":
            # ASSEMBLY: Only show KOTs where the PARENT status is 'Preparing'
            valid_assembly_kots = frappe.get_all("Kitchen Order Ticket",
                filters={"name": ["in", valid_kot_names], "status": "Preparing"}, pluck="name")
            
            if not valid_assembly_kots:
                return []
            filters = {"parent": ["in", valid_assembly_kots]}
        else:
            # COOKING STATIONS: Show items assigned to this station 
            # that are still in 'Pending' or 'Preparing' state
            filters = {
                "parent": ["in", valid_kot_names],
                "kds": station_name,
                "status": ["in", ["Pending", "Preparing"]]
            }

        # Fetch items
        items = frappe.get_all(CHILD_DOCTYPE, filters=filters, 
            fields=["name", "parent", "item_name", "qty", "status", "kds", "item"])

        # 3. Grouping items by KOT
        grouped_data = {}
        for item in items:
            kot = item.parent
            if kot not in grouped_data:
                kot_info = frappe.db.get_value("Kitchen Order Ticket", kot, 
                           ["invoice_no", "table", "floor"], as_dict=True)
                if not kot_info: 
                    continue 
                
                grouped_data[kot] = {
                    "kot_id": kot,
                    "invoice_id": kot_info.get("invoice_no") or "N/A",
                    "table": kot_info.get("table") or "N/A",
                    "floor": kot_info.get("floor") or "N/A",
                    "items": []
                }
            grouped_data[kot]["items"].append(item)

        return list(grouped_data.values())
        
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "KDS Get Items Error")
        return []
    
@frappe.whitelist()
def update_item_status():
    """
    Update individual item status and synchronize parent KOT status.
    """
    # Use form_dict to handle POST data
    child_id = frappe.form_dict.get("child_id")
    new_status = frappe.form_dict.get("new_status")

    if not child_id or not new_status:
        return {"success": False, "message": "Missing child_id or new_status"}

    try:
        # 1. Update the item status
        frappe.db.set_value(CHILD_DOCTYPE, child_id, "status", new_status)
        
        # 2. Get the parent KOT name
        parent_kot = frappe.db.get_value(CHILD_DOCTYPE, child_id, "parent")
        if not parent_kot:
            return {"success": False, "message": "Parent KOT not found"}

        # 3. Fetch current status of all items for this KOT
        all_items = frappe.get_all(
            CHILD_DOCTYPE, 
            filters={"parent": parent_kot}, 
            fields=["status"]
        )
        
        # 4. Determine KOT status based on child items
        # Logic: 
        # - If ALL items are 'Ready' -> 'Assembly' (Waiting for final touch)
        # - Else if ANY item is 'Preparing' -> 'Preparing'
        # - Else -> 'Pending'
        
        item_statuses = [i.status for i in all_items]
        
        if all(s == 'Ready' for s in item_statuses):
            # Jab sab items ready ho jayen, to order Assembly station par show hoga
            new_kot_status = "Assembly"
        elif any(s == 'Preparing' for s in item_statuses):
            new_kot_status = "Preparing"
        else:
            new_kot_status = "Pending"
            
        # 5. Update Parent KOT status
        frappe.db.set_value("Kitchen Order Ticket", parent_kot, "status", new_kot_status, update_modified=True)
        
        # Ensure all changes are committed to the database
        frappe.db.commit()
        
        return {"success": True, "new_kot_status": new_kot_status}
        
    except Exception as e:
        frappe.db.rollback() 
        frappe.log_error(frappe.get_traceback(), "KDS Update Status Error")
        return {"success": False, "error": str(e)}
    
@frappe.whitelist()
def finalize_assembly(kot_id):
    try:
        # Update status to match the string used in Customer Screen filters
        frappe.db.set_value("Kitchen Order Ticket", kot_id, "status", "Ready for Pick-Up", update_modified=True)
        frappe.db.commit()
        return {"success": True, "message": "KOT finalized"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Finalize Assembly Error")
        return {"success": False, "error": str(e)}
    
@frappe.whitelist(allow_guest=True)
def get_customer_display_data(branch):
    try:
        # Fetching BOTH statuses to be safe
        orders = frappe.get_all("Kitchen Order Ticket", 
            filters={
                "branch": branch, 
                "status": ["in", ["Ready for Pick-Up", "Preparing"]], 
                "docstatus": 0
            }, 
            fields=["name", "status"]
        )
        
        return {
            "ready": [o.name.split("-")[-1] for o in orders if o.status == "Ready for Pick-Up"],
            "preparing": [o.name.split("-")[-1] for o in orders if o.status == "Preparing"]
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Customer Display Error")
        return {"ready": [], "preparing": []}
    
@frappe.whitelist()
def get_kot_history(branch):
    from datetime import datetime, timedelta
    
    # 1. Pichle 10 ghante ka time (24 ki jagah 10)
    ten_hours_ago = (datetime.now() - timedelta(hours=10)).strftime('%Y-%m-%d %H:%M:%S')
    
    # 2. Sirf finalize ho chuke (Picked Up) KOTs
    history_kots = frappe.get_all("Kitchen Order Ticket", 
        filters={
            "branch": branch, 
            "status": "Picked Up", 
            "modified": [">=", ten_hours_ago]
        },
        fields=["name", "invoice_no", "table", "creation", "modified"],
        order_by="modified desc"
    )
    
    # 3. Har KOT ke items fetch karo
    # Note: Agar CHILD_DOCTYPE define nahi hai, to yahan "Kitchen Order Item" use karein
    child_doctype = "Kitchen Order Item" 
    
    for kot in history_kots:
        kot["items"] = frappe.get_all(child_doctype, 
            filters={"parent": kot.name}, 
            fields=["item_name", "qty"])
            
    return history_kots
@frappe.whitelist()
def create_kot(payload):
    import json
    try:
        data = json.loads(payload)
        frappe.log_error(title="KOT Payload Debug", message=frappe.as_json(data))
        
        items = data.get("items", [])
        if not items:
            return {"success": False, "message": "No items provided"}

        branch = data.get("branch")
        order_type = data.get("order_type")
        table = data.get("table_no")
        # Find floor from table if needed, or leave it blank
        floor = None
        if table:
            table_doc = frappe.get_all("Table", or_filters={"table_name": table, "name": table}, fields=["floor"], limit=1)
            if table_doc:
                floor = table_doc[0].floor
        
        kot = frappe.new_doc("Kitchen Order Ticket")
        kot.branch = branch
        
        # Match order_type dynamically
        valid_options = frappe.get_meta("Kitchen Order Ticket").get_field("order_type").options
        matched_type = order_type
        if valid_options and order_type:
            for opt in valid_options.split("\n"):
                if opt and opt.lower().replace("-", "").replace(" ", "") == order_type.lower().replace("-", "").replace(" ", ""):
                    matched_type = opt
                    break
        kot.order_type = matched_type
        
        kot.table = table
        kot.floor = floor
        kot.status = "Pending"
        kot.invoice_no = data.get("invoice_no")
        
        items_added = 0
        for item in items:
            item_code = item.get("item_code")
            item_doc = frappe.get_doc("Item", item_code)
            
            kds_station = item_doc.custom_kds_station
            if not kds_station:
                continue # Skip items without a KDS station
                
            kot.append("item", {
                "item": item_code,
                "item_name": item_doc.item_name,
                "qty": item.get("qty", 1),
                "uom": item_doc.stock_uom,
                "kds": kds_station,
                "status": "Pending"
            })
            items_added += 1
            
        if items_added == 0:
            return {"success": False, "message": "No items with a KDS Station assigned were found."}
            
        kot.insert(ignore_permissions=True)
        frappe.db.commit()
        
        return {"success": True, "message": "KOT Created", "name": kot.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "KDS Create KOT Error")
        return {"success": False, "message": str(e)}

def create_kot_from_invoice(doc, method=None):
    import frappe
    # Check if KOT already exists for this invoice
    if frappe.db.exists("Kitchen Order Ticket", {"invoice_no": doc.name}):
        return

    # Gather items that have a KDS station
    items_added = 0
    kot = frappe.new_doc("Kitchen Order Ticket")
    
    # Try to get branch from POS Profile
    branch = None
    if doc.get("pos_profile"):
        branch = frappe.db.get_value("POS Profile", doc.get("pos_profile"), "branch")
    
    # Validate branch exists to prevent LinkValidationError on insert
    if branch and frappe.db.exists("Branch", branch):
        kot.branch = branch

    # Get order_type, table, floor
    raw_order_type = doc.get("posa_order_type") or "Dine In"
    
    # Match order_type dynamically to avoid validation errors
    valid_options = frappe.get_meta("Kitchen Order Ticket").get_field("order_type").options
    matched_type = raw_order_type
    if valid_options and raw_order_type:
        for opt in valid_options.split("\n"):
            if opt and opt.lower().replace("-", "").replace(" ", "") == raw_order_type.lower().replace("-", "").replace(" ", ""):
                matched_type = opt
                break
    
    kot.order_type = matched_type
    kot.table = doc.get("posa_table_no")
    kot.floor = None
    if kot.table:
        table_doc = frappe.get_all("Table", or_filters={"table_name": kot.table, "name": kot.table}, fields=["floor"], limit=1)
        if table_doc:
            kot.floor = table_doc[0].floor

    kot.status = "Pending"
    kot.invoice_no = doc.name

    for item in doc.get("items") or []:
        kds_station = frappe.db.get_value("Item", item.item_code, "custom_kds_station")
        if not kds_station:
            continue

        kot.append("item", {
            "item": item.item_code,
            "item_name": item.item_name,
            "qty": item.qty,
            "uom": item.stock_uom or item.uom,
            "kds": kds_station,
            "status": "Pending"
        })
        items_added += 1

    if items_added > 0:
        kot.insert(ignore_permissions=True)
        # We don't commit here because we are in a document event (transaction)


def validate_table_availability(doc, method=None):
    import frappe
    
    order_type = doc.get("posa_order_type") or ""
    # If order type is Delivery or Takeaway, table should not be used
    if order_type.lower() in ["delivery", "takeaway"]:
        if doc.get("posa_table_no"):
            frappe.throw(f"You cannot select a Table for {order_type} orders. Please remove the table or change the order type.")

    if not doc.get("posa_table_no"):
        return

    is_new_table = False
    if not doc.name or doc.get("__islocal"):
        is_new_table = True
    else:
        old_doc = doc.get_doc_before_save()
        if old_doc:
            old_table = old_doc.get("posa_table_no")
        else:
            old_table = frappe.db.get_value(doc.doctype, doc.name, "posa_table_no")
        if old_table != doc.get("posa_table_no"):
            is_new_table = True

    if is_new_table:
        status = frappe.db.get_value("Table", doc.get("posa_table_no"), "status")
        if status and status != "Available":
            frappe.throw(f"Table {doc.get('posa_table_no')} is currently {status}. You can only create an order for an Available table.")

def update_table_status(doc, method=None):
    import frappe
    
    frappe.log_error(title="KDS update_table_status call", message=f"doc: {doc.name}, doctype: {doc.doctype}, docstatus: {doc.docstatus}, posa_table_no: {doc.get('posa_table_no')}")

    old_table = None
    if not doc.get("__islocal") and doc.name:
        old_doc = doc.get_doc_before_save()
        if old_doc:
            old_table = old_doc.get("posa_table_no")
            
    new_table = doc.get("posa_table_no")
    
    if old_table and old_table != new_table:
        # Free the old table
        frappe.db.set_value("Table", old_table, "status", "Available")
        
    if new_table:
        if doc.docstatus in [1, 2]:
            frappe.db.set_value("Table", new_table, "status", "Available")
        else:
            status = frappe.db.get_value("Table", new_table, "status")
            frappe.log_error(title="KDS update_table_status details", message=f"new_table: {new_table}, status: {status}")
            if status == "Available":
                frappe.db.set_value("Table", new_table, "status", "Occupied")


def free_table(doc, method=None):
    import frappe
    if not doc.get("posa_table_no"):
        return
        
    frappe.db.set_value("Table", doc.get("posa_table_no"), "status", "Available")
