const fs = require('fs');

const serverPath = 'c:/GroundRodERP/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Add vendor_po_line_items check right after client_po_line_items
const oldLine = `{ query: "SELECT COUNT(*) as count FROM client_po_line_items WHERE product_id=?", name: "Client Purchase Orders" },`;

const newLines = `{ query: "SELECT COUNT(*) as count FROM client_po_line_items WHERE product_id=?", name: "Client Purchase Orders" },
    { query: "SELECT COUNT(*) as count FROM vendor_po_line_items WHERE product_id=?", name: "Vendor Purchase Orders" },`;

if (!content.includes(oldLine)) {
  console.log('❌ Could not find target line');
  process.exit(1);
}

content = content.replace(oldLine, newLines);

fs.writeFileSync(serverPath, content, 'utf8');

console.log('✅ Fixed DELETE endpoint - added vendor PO check!');
console.log('✓ Products used in vendor POs will now be protected from deletion');
console.log('✓ DELETE will show helpful error message listing vendor POs');
