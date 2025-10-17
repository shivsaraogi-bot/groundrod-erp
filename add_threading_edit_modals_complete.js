const fs = require('fs');

console.log('🎯 Adding threading to ALL edit modals (complete)...\n');

let app = fs.readFileSync('public/app.restored.js', 'utf8');

// ============================================================================
// STEP 1: Add threading fields to Products edit modal (after description)
// ============================================================================
console.log('1. Adding threading to Products edit modal...');

const productsEditPattern = /React\.createElement\('div', \{ className:'md:col-span-1' \},\n\s+React\.createElement\('label',.*?'Description'\),\n\s+React\.createElement\('input',.*?editForm\.description.*?\}\)\n\s+\),/;

const productsEditWithThreading = `React.createElement('div', { className:'md:col-span-1' },
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Description'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.description || '', onChange:e=>setEditForm({...editForm, description:e.target.value}) })
            ),
            React.createElement('div', null,
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Threading'),
              React.createElement('select', { className:'border rounded px-3 py-2 w-full', value:editForm.threading || 'Plain', onChange:e=>setEditForm({...editForm, threading:e.target.value}) },
                React.createElement('option', { value:'Plain' }, 'Plain'),
                React.createElement('option', { value:'Threaded' }, 'Threaded'),
                React.createElement('option', { value:'Partially Threaded' }, 'Partially Threaded')
              )
            ),
            React.createElement('div', null,
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Base Product ID'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full', placeholder:'Link to base product', value:editForm.base_product_id || '', onChange:e=>setEditForm({...editForm, base_product_id:e.target.value}) })
            ),`;

app = app.replace(productsEditPattern, productsEditWithThreading);

console.log('   ✓ Threading fields added to Products edit modal');

// ============================================================================
// STEP 2: Update Products save function to include threading
// ============================================================================
console.log('\n2. Updating Products edit save function...');

const productsSavePattern = /await fetch\(`\$\{API_URL\}\/products\/\$\{encodeURIComponent\(urlId\)\}`, \{ method:'PUT', headers:\{'Content-Type':'application\/json'\}, body: JSON\.stringify\(\{ \.\.\.editForm, steel_diameter:diameterMM, length:lengthMM, copper_coating:Number\(editForm\.copper_coating\) \}\) \}\);/;

const productsSaveWithThreading = `await fetch(\`\${API_URL}/products/\${encodeURIComponent(urlId)}\`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...editForm, steel_diameter:diameterMM, length:lengthMM, copper_coating:Number(editForm.copper_coating), base_product_id:editForm.base_product_id || editForm.id, threading:editForm.threading || 'Plain' }) });`;

app = app.replace(productsSavePattern, productsSaveWithThreading);

console.log('   ✓ Products save function updated');

fs.writeFileSync('public/app.restored.js', app, 'utf8');

console.log('\n✅ Threading added to edit modals!');
console.log('\nCompleted:');
console.log('- Products edit modal: Threading dropdown + Base Product ID field');
console.log('- Products save function: Includes threading and base_product_id');
console.log('\nNote:');
console.log('- Client PO threading already in line items state (completed in v37.23)');
console.log('- Vendor PO: Threading only applies to products, not raw materials');
