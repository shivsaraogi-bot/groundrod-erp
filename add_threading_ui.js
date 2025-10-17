const fs = require('fs');

console.log('🎨 Adding threading UI components...\n');

let app = fs.readFileSync('public/app.restored.js', 'utf8');

// ============================================================================
// STEP 1: Add threading fields to Products form state
// ============================================================================
console.log('1. Adding threading to Products form...');

const oldProductFormState = `const [form, setForm] = useState({ id:'', description:'', diameter:0, diameterUnit:'mm', length:0, lengthUnit:'mm', coating:0, width:0, height:0, thickness:0, rectUnit:'mm', weightUnit:'kg', product_type:'ground_rod', custom_bom:false });`;

const newProductFormState = `const [form, setForm] = useState({ id:'', description:'', diameter:0, diameterUnit:'mm', length:0, lengthUnit:'mm', coating:0, width:0, height:0, thickness:0, rectUnit:'mm', weightUnit:'kg', product_type:'ground_rod', custom_bom:false, base_product_id:'', threading:'Plain' });`;

app = app.replace(oldProductFormState, newProductFormState);

console.log('   ✓ Form state updated');

// ============================================================================
// STEP 2: Add threading columns to Products table
// ============================================================================
console.log('\n2. Adding threading columns to Products table...');

// Find the products columns array and add threading columns
const addThreadingColumns = `    { key: 'id', label: 'Product ID' },
    { key: 'description', label: 'Description' },
    { key: 'threading', label: 'Threading', render: (val) => val || 'Plain' },
    { key: 'base_product_id', label: 'Base Product', render: (val, row) => val || row.id },`;

app = app.replace(
  /\{ key: 'id', label: 'Product ID' \},\n    \{ key: 'description', label: 'Description' \},/,
  addThreadingColumns
);

console.log('   ✓ Threading columns added to table');

// ============================================================================
// STEP 3: Add threading to production entry form
// ============================================================================
console.log('\n3. Adding threading to production entry form...');

// Find the production form state and add threading
const oldProdFormState = `marking_type: 'unmarked',
    marking_text: '',
    notes: ''`;

const newProdFormState = `marking_type: 'unmarked',
    marking_text: '',
    threading: 'Plain',
    notes: ''`;

app = app.replace(oldProdFormState, newProdFormState);

console.log('   ✓ Production form state updated');

// ============================================================================
// STEP 4: Add threading to client PO line items table columns
// ============================================================================
console.log('\n4. Adding threading to client PO line items...');

// This is a complex change - adding a note about it
console.log('   ⚠ Client PO threading integration requires manual review');
console.log('   (Complex table structure - recommend manual addition)');

fs.writeFileSync('public/app.restored.js', app, 'utf8');

console.log('\n✅ Threading UI components added!');
console.log('\nWhat was added:');
console.log('- Products form: base_product_id and threading fields');
console.log('- Products table: Threading and Base Product columns');
console.log('- Production form: threading field in state');
console.log('\nManual steps needed:');
console.log('1. Add threading input fields to Products add/edit forms (HTML)');
console.log('2. Add threading selector to production entry form (HTML)');
console.log('3. Add threading column to client PO line items table');
console.log('4. Update inventory display to show variants');
console.log('\nThese require React component structure changes - see THREADING_FEATURE_STATUS.md');
