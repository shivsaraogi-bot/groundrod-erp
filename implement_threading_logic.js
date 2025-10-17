const fs = require('fs');

console.log('🔧 Implementing threading logic updates...\n');

let server = fs.readFileSync('server.js', 'utf8');

// ============================================================================
// STEP 2: Update /api/inventory endpoint to consolidate by base_product_id
// ============================================================================
console.log('2. Updating inventory tracking logic...');

// Replace the inventory endpoint to use base_product_id for early stages
const oldInventoryEndpoint = `app.get('/api/inventory', (req, res) => {
  db.all(\`
    SELECT
      i.*,
      p.description as product_description,
      (i.stamped - COALESCE(i.committed, 0)) as available
    FROM inventory i
    LEFT JOIN products p ON i.product_id = p.id
    ORDER BY p.description
  \`, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      // Add computed fields
      const enrichedRows = (rows || []).map(row => ({
        ...row,
        total_wip: (row.plated || 0) + (row.machined || 0) + (row.qc || 0),
        total_stock: (row.plated || 0) + (row.machined || 0) + (row.qc || 0) + (row.stamped || 0) + (row.steel_rods || 0),
        committed: row.committed || 0,
        available: Math.max(0, (row.stamped || 0) - (row.committed || 0))
      }));
      res.json(enrichedRows);
    }
  });
});`;

const newInventoryEndpoint = `app.get('/api/inventory', (req, res) => {
  // Consolidate early stages (steel_rods, plated, machined) by base_product_id
  // Split later stages (stamped, packed) by actual product_id (threading variant)

  db.all(\`
    SELECT
      COALESCE(p.base_product_id, p.id) as base_product_id,
      p.id as product_id,
      p.description,
      p.threading,
      SUM(i.steel_rods) as steel_rods_total,
      SUM(i.plated) as plated_total,
      SUM(i.machined) as machined_total,
      i.stamped,
      i.packed,
      i.committed,
      (i.stamped - COALESCE(i.committed, 0)) as available
    FROM inventory i
    LEFT JOIN products p ON i.product_id = p.id
    GROUP BY COALESCE(p.base_product_id, p.id), p.id, p.description, p.threading, i.stamped, i.packed, i.committed
    ORDER BY COALESCE(p.base_product_id, p.id), p.threading
  \`, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Consolidate early stages by base_product, keep later stages separate
    const consolidated = {};

    (rows || []).forEach(row => {
      const baseId = row.base_product_id;

      if (!consolidated[baseId]) {
        consolidated[baseId] = {
          product_id: baseId,
          base_product_id: baseId,
          description: row.description.replace(/ - (Plain|Threaded|Partially Threaded)$/, ''),
          steel_rods: 0,
          plated: 0,
          machined: 0,
          variants: []
        };
      }

      // Accumulate early stages (shared across variants)
      consolidated[baseId].steel_rods += Number(row.steel_rods_total || 0);
      consolidated[baseId].plated += Number(row.plated_total || 0);
      consolidated[baseId].machined += Number(row.machined_total || 0);

      // Keep later stages separate by variant
      if (row.stamped > 0 || row.packed > 0 || row.threading) {
        consolidated[baseId].variants.push({
          product_id: row.product_id,
          threading: row.threading || 'Plain',
          stamped: Number(row.stamped || 0),
          packed: Number(row.packed || 0),
          committed: Number(row.committed || 0),
          available: Math.max(0, Number(row.stamped || 0) - Number(row.committed || 0))
        });
      }
    });

    // Convert to array and add computed fields
    const result = Object.values(consolidated).map(item => ({
      ...item,
      total_wip: item.plated + item.machined,
      total_stamped: item.variants.reduce((sum, v) => sum + v.stamped, 0),
      total_packed: item.variants.reduce((sum, v) => sum + v.packed, 0),
      total_stock: item.steel_rods + item.plated + item.machined +
                   item.variants.reduce((sum, v) => sum + v.stamped + v.packed, 0)
    }));

    res.json(result);
  });
});`;

server = server.replace(oldInventoryEndpoint, newInventoryEndpoint);

console.log('   ✓ Inventory consolidation logic added');

fs.writeFileSync('server.js', server, 'utf8');

console.log('\n✅ Threading logic updates complete!');
console.log('\nWhat changed:');
console.log('- /api/inventory now consolidates steel_rods, plated, machined by base_product_id');
console.log('- Stamped and packed inventory split by threading variant');
console.log('- Response includes variants array with threading-specific inventory');
console.log('\nExample response structure:');
console.log('{');
console.log('  product_id: "NFPL19X3",');
console.log('  base_product_id: "NFPL19X3",');
console.log('  description: "19mm x 3m Rod",');
console.log('  steel_rods: 0,');
console.log('  plated: 200,');
console.log('  machined: 150,');
console.log('  total_wip: 350,');
console.log('  variants: [');
console.log('    { product_id: "NFPL19X3", threading: "Plain", stamped: 60, packed: 50 },');
console.log('    { product_id: "NFPL19X3T", threading: "Threaded", stamped: 40, packed: 35 }');
console.log('  ]');
console.log('}');
