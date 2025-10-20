-- Run this in Render Shell to delete all client POs and invoices
-- Navigate to: Render Dashboard > Your Service > Shell > sqlite3 groundrod.db

BEGIN TRANSACTION;

DELETE FROM shipments;
DELETE FROM invoices;
DELETE FROM client_po_line_items;
DELETE FROM inventory_allocations;
DELETE FROM client_purchase_orders;

COMMIT;

-- Verify deletion:
SELECT COUNT(*) as remaining_pos FROM client_purchase_orders;
SELECT COUNT(*) as remaining_invoices FROM invoices;
