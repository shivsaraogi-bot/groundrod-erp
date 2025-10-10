// CSV Import Endpoints and BOM Auto-Generation
// Add these endpoints to server.js after the existing import endpoints

const { parse } = require('csv-parse/sync');

// ============= CSV BULK IMPORT ENDPOINTS =============

// Import Vendors from CSV
app.post('/api/bulk-import/vendors', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const csvData = req.file.buffer.toString('utf-8');
    const records = parse(csvData, { columns: true, skip_empty_lines: true });

    let imported = 0, errors = [];

    for (const row of records) {
      try {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO vendors (id, name, office_address, contact_person, phone, email, vendor_type, material_type, city, country)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id || row.vendor_id,
              row.name,
              row.office_address || row.address || '',
              row.contact_person || '',
              row.phone || '',
              row.email || '',
              row.vendor_type || 'Other',
              row.material_type || '',
              row.city || '',
              row.country || ''
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
        imported++;
      } catch (err) {
        errors.push({ row: row.id || row.name, error: err.message });
      }
    }

    res.json({
      message: `Imported ${imported} vendors`,
      imported,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import Customers from CSV
app.post('/api/bulk-import/customers', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const csvData = req.file.buffer.toString('utf-8');
    const records = parse(csvData, { columns: true, skip_empty_lines: true });

    let imported = 0, errors = [];

    for (const row of records) {
      try {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO customers (id, name, address, contact_person, phone, email, city, country)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id || row.customer_id,
              row.name,
              row.address || '',
              row.contact_person || '',
              row.phone || '',
              row.email || '',
              row.city || '',
              row.country || ''
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
        imported++;
      } catch (err) {
        errors.push({ row: row.id || row.name, error: err.message });
      }
    }

    res.json({
      message: `Imported ${imported} customers`,
      imported,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import Products from CSV with Auto-BOM Generation
app.post('/api/bulk-import/products', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const csvData = req.file.buffer.toString('utf-8');
    const records = parse(csvData, { columns: true, skip_empty_lines: true });

    let imported = 0, errors = [];

    for (const row of records) {
      try {
        const steelDiameter = parseFloat(row.steel_diameter || row.diameter || 0);
        const copperCoating = parseFloat(row.copper_coating || row.coating || 0);
        const length = parseFloat(row.length || 3000);

        // Calculate CBG diameter automatically
        const cbgDiameter = steelDiameter + (copperCoating * 2 / 1000);

        // Insert product
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO products (id, description, steel_diameter, copper_coating, cbg_diameter, length, weight, cost_price, hs_code, export_description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id || row.product_id,
              row.description,
              steelDiameter,
              copperCoating,
              cbgDiameter,
              length,
              parseFloat(row.weight || 0),
              parseFloat(row.cost_price || 0),
              row.hs_code || '',
              row.export_description || row.description || ''
            ],
            (err) => err ? reject(err) : resolve()
          );
        });

        // Auto-generate BOM based on product specifications
        await generateBOM(row.id || row.product_id, steelDiameter, copperCoating, length);

        imported++;
      } catch (err) {
        errors.push({ row: row.id || row.description, error: err.message });
      }
    }

    res.json({
      message: `Imported ${imported} products with auto-generated BOMs`,
      imported,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function: Auto-generate BOM based on product specifications
async function generateBOM(productId, steelDiameter, copperCoating, length) {
  // Calculate steel rod weight (kg)
  // Formula: (π/4) × diameter² × length × density
  // Steel density ≈ 7.85 g/cm³ = 7850 kg/m³
  const steelRadiusMM = steelDiameter / 2;
  const steelVolumeMM3 = Math.PI * steelRadiusMM * steelRadiusMM * length;
  const steelVolumeCM3 = steelVolumeMM3 / 1000;
  const steelWeightKg = (steelVolumeCM3 * 7.85) / 1000;

  // Calculate copper weight (kg)
  // Copper coating is in microns, need to calculate volume of coating
  const steelRadiusCM = steelDiameter / 20; // mm to cm, then divide by 2
  const copperRadiusCM = (steelDiameter / 2 + copperCoating / 1000) / 10; // Add coating, convert to cm
  const lengthCM = length / 10;
  const copperVolumeCM3 = Math.PI * (copperRadiusCM * copperRadiusCM - steelRadiusCM * steelRadiusCM) * lengthCM;
  const copperWeightKg = (copperVolumeCM3 * 8.96) / 1000; // Copper density ≈ 8.96 g/cm³

  // Insert Steel requirement
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit)
       VALUES (?, ?, ?)`,
      [productId, 'Steel', steelWeightKg],
      (err) => err ? reject(err) : resolve()
    );
  });

  // Insert Copper Anode requirement
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit)
       VALUES (?, ?, ?)`,
      [productId, 'Copper Anode', copperWeightKg],
      (err) => err ? reject(err) : resolve()
    );
  });

  return { steel: steelWeightKg, copper: copperWeightKg };
}

// Export BOM calculation function for use in product creation
module.exports = { generateBOM };
