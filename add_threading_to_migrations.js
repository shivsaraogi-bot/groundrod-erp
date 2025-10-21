const fs = require('fs');

const serverPath = 'c:/GroundRodERP/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find the products migration line
const oldLine = `if(!n.includes('is_deleted')) db.run("ALTER TABLE products ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{});`;

const newLine = `if(!n.includes('is_deleted')) db.run("ALTER TABLE products ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); if(!n.includes('threading')) db.run("ALTER TABLE products ADD COLUMN threading TEXT DEFAULT 'Plain'", ()=>{}); if(!n.includes('base_product_id')) db.run("ALTER TABLE products ADD COLUMN base_product_id TEXT", ()=>{});`;

if (!content.includes(oldLine)) {
  console.log('❌ Could not find products migration line');
  process.exit(1);
}

content = content.replace(oldLine, newLine);

fs.writeFileSync(serverPath, content, 'utf8');

console.log('✅ Added threading columns to auto-migration!');
console.log('✓ threading TEXT DEFAULT \'Plain\'');
console.log('✓ base_product_id TEXT');
console.log('\nThese will be automatically added when Render restarts');
