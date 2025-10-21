const fs = require('fs');

const serverPath = 'c:/GroundRodERP/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Add threading and base_product_id extraction at the top of the PUT endpoint
const oldExtraction = `  const oldId = req.params.id;
  const newId = (req.body.id || oldId).toString();
  const description = (req.body.description||'').toString();
  const steel_diameter = Number(req.body.steel_diameter ?? req.body.diameter);
  const copper_coating = Number(req.body.copper_coating ?? req.body.coating);
  const length = Number(req.body.length ?? req.body.length_mm);
  const active = req.body.active ?? 1;
  const category = (req.body.category||'').toString() || null;`;

const newExtraction = `  const oldId = req.params.id;
  const newId = (req.body.id || oldId).toString();
  const description = (req.body.description||'').toString();
  const steel_diameter = Number(req.body.steel_diameter ?? req.body.diameter);
  const copper_coating = Number(req.body.copper_coating ?? req.body.coating);
  const length = Number(req.body.length ?? req.body.length_mm);
  const active = req.body.active ?? 1;
  const category = (req.body.category||'').toString() || null;
  const threading = (req.body.threading || 'Plain').toString();
  const base_product_id = (req.body.base_product_id || newId).toString();`;

content = content.replace(oldExtraction, newExtraction);

// Update the ID-changed UPDATE to include threading fields
const oldUpdateWithIdChange = `        const sets = ['id=?','description=?','steel_diameter=?','copper_coating=?','length=?','active=?'];
        const vals = [newId, description, steel_diameter, copper_coating, length, active];`;

const newUpdateWithIdChange = `        const sets = ['id=?','description=?','steel_diameter=?','copper_coating=?','length=?','active=?','threading=?','base_product_id=?'];
        const vals = [newId, description, steel_diameter, copper_coating, length, active, threading, base_product_id];`;

content = content.replace(oldUpdateWithIdChange, newUpdateWithIdChange);

// Update the ID-not-changed UPDATE to include threading fields
const oldUpdateNoIdChange = `      const sets = ['description=?','steel_diameter=?','copper_coating=?','length=?','active=?'];
      const vals = [description, steel_diameter, copper_coating, length, active];`;

const newUpdateNoIdChange = `      const sets = ['description=?','steel_diameter=?','copper_coating=?','length=?','active=?','threading=?','base_product_id=?'];
      const vals = [description, steel_diameter, copper_coating, length, active, threading, base_product_id];`;

content = content.replace(oldUpdateNoIdChange, newUpdateNoIdChange);

fs.writeFileSync(serverPath, content, 'utf8');

console.log('✅ Fixed Product PUT endpoint!');
console.log('✓ Added threading and base_product_id extraction');
console.log('✓ Updated both UPDATE statements (with and without ID change)');
console.log('✓ Products can now be edited with threading fields');
