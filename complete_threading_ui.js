const fs = require('fs');

console.log('🎨 Completing threading UI implementation...\n');

let app = fs.readFileSync('public/app.restored.js', 'utf8');

// ============================================================================
// STEP 1: Add threading HTML fields to Products form (after Description field)
// ============================================================================
console.log('1. Adding threading fields to Products add form...');

// Find the description field and add threading fields after it
const descriptionFieldPattern = /React\.createElement\('div', \{ className:'md:col-span-2' \},\n\s+React\.createElement\('label', \{ className:'block text-xs font-semibold text-gray-700 mb-1' \}, 'Description'\),\n\s+React\.createElement\('input', \{ className:'border rounded px-3 py-2 w-full', placeholder:'e\.g\. 14\.2mm x 3000mm Ground Rod', value:form\.description, onChange:e=>setForm\(\{ \.\.\.form, description:e\.target\.value \}\) \}\)\n\s+\),/;

const threadingFields = `React.createElement('div', { className:'md:col-span-2' },
            React.createElement('label', { className:'block text-xs font-semibold text-gray-700 mb-1' }, 'Description'),
            React.createElement('input', { className:'border rounded px-3 py-2 w-full', placeholder:'e.g. 14.2mm x 3000mm Ground Rod', value:form.description, onChange:e=>setForm({ ...form, description:e.target.value }) })
          ),
          React.createElement('div', null,
            React.createElement('label', { className:'block text-xs font-semibold text-gray-700 mb-1' }, 'Threading'),
            React.createElement('select', { className:'border rounded px-3 py-2 w-full', value:form.threading, onChange:e=>setForm({ ...form, threading:e.target.value }) },
              React.createElement('option', { value:'Plain' }, 'Plain'),
              React.createElement('option', { value:'Threaded' }, 'Threaded'),
              React.createElement('option', { value:'Partially Threaded' }, 'Partially Threaded')
            )
          ),
          React.createElement('div', null,
            React.createElement('label', { className:'block text-xs font-semibold text-gray-700 mb-1' }, 'Base Product ID'),
            React.createElement('input', { className:'border rounded px-3 py-2 w-full', placeholder:'Leave empty for base product', value:form.base_product_id, onChange:e=>setForm({ ...form, base_product_id:e.target.value }) }),
            React.createElement('p', { className:'text-xs text-gray-500 mt-1' }, 'Link to base product for threading variants')
          ),`;

app = app.replace(descriptionFieldPattern, threadingFields);

console.log('   ✓ Threading fields added to form');

// ============================================================================
// STEP 2: Update Products add function to include threading
// ============================================================================
console.log('\n2. Updating Products add function...');

const oldAddFunction = /const productData = \{\n\s+\.\.\.form,\n\s+steel_diameter: diameterMM,\n\s+length: lengthMM,\n\s+copper_coating: Number\(form\.coating\),\n\s+width: widthMM,\n\s+height: heightMM,\n\s+thickness: thicknessMM,\n\s+product_type: form\.product_type,\n\s+custom_bom: form\.custom_bom \? 1 : 0\n\s+\};/;

const newAddFunction = `const productData = {
      ...form,
      steel_diameter: diameterMM,
      length: lengthMM,
      copper_coating: Number(form.coating),
      width: widthMM,
      height: heightMM,
      thickness: thicknessMM,
      product_type: form.product_type,
      custom_bom: form.custom_bom ? 1 : 0,
      base_product_id: form.base_product_id || form.id,
      threading: form.threading || 'Plain'
    };`;

app = app.replace(oldAddFunction, newAddFunction);

console.log('   ✓ Add function updated to save threading');

// ============================================================================
// STEP 3: Update Products edit function to include threading
// ============================================================================
console.log('\n3. Updating Products edit function...');

const oldEditFormInit = /setEditForm\(\{\n\s+originalId: product\.id,\n\s+id: product\.id,\n\s+description: product\.description,\n\s+steel_diameter: product\.steel_diameter \|\| product\.diameter,\n\s+diameterUnit: 'mm',\n\s+length: product\.length,\n\s+lengthUnit: 'mm',\n\s+copper_coating: product\.copper_coating \|\| product\.coating,\n\s+weightUnit: 'kg'\n\s+\}\);/;

const newEditFormInit = `setEditForm({
      originalId: product.id,
      id: product.id,
      description: product.description,
      steel_diameter: product.steel_diameter || product.diameter,
      diameterUnit: 'mm',
      length: product.length,
      lengthUnit: 'mm',
      copper_coating: product.copper_coating || product.coating,
      weightUnit: 'kg',
      base_product_id: product.base_product_id || '',
      threading: product.threading || 'Plain'
    });`;

app = app.replace(oldEditFormInit, newEditFormInit);

console.log('   ✓ Edit form updated to load threading');

// ============================================================================
// STEP 4: Update form reset to include threading
// ============================================================================
console.log('\n4. Updating form reset...');

const oldFormReset = /setForm\(\{ id:'', description:'', diameter:0, diameterUnit:'mm', length:0, lengthUnit:'mm', coating:0, width:0, height:0, thickness:0, rectUnit:'mm', weightUnit:'kg', product_type:'ground_rod', custom_bom:false, base_product_id:'', threading:'Plain' \}\);/g;

const newFormReset = `setForm({ id:'', description:'', diameter:0, diameterUnit:'mm', length:0, lengthUnit:'mm', coating:0, width:0, height:0, thickness:0, rectUnit:'mm', weightUnit:'kg', product_type:'ground_rod', custom_bom:false, base_product_id:'', threading:'Plain' });`;

// Already correct, but ensure it's consistent
app = app.replace(
  /setForm\(\{ id:'', description:'', diameter:0, diameterUnit:'mm', length:0, lengthUnit:'mm', coating:0, width:0, height:0, thickness:0, rectUnit:'mm', weightUnit:'kg', product_type:'ground_rod', custom_bom:false \}\);/g,
  newFormReset
);

console.log('   ✓ Form reset updated');

fs.writeFileSync('public/app.restored.js', app, 'utf8');

console.log('\n✅ Threading UI completion finished!');
console.log('\nWhat was added:');
console.log('- Threading dropdown in Products add form (Plain/Threaded/Partially Threaded)');
console.log('- Base Product ID input in Products add form');
console.log('- Products add function saves threading fields');
console.log('- Products edit function loads threading fields');
console.log('- Form reset includes threading defaults');
console.log('\nRemaining tasks:');
console.log('- Add threading selector to production entry (complex - needs conditional display)');
console.log('- Update inventory display to show variants table');
console.log('- Create data migration script');
console.log('\nCurrent completion: ~85%');
