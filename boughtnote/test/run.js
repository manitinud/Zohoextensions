/* Unit tests for the Bought Note pure-logic modules. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

const sandbox = {
  console, module: {}, exports: {}, Promise, Uint8Array,
  PDFLib: require(path.join(SCRATCH, 'pdf-lib'))
};
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['boughtnote.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const { BoughtNote } = sandbox;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  <- ' + extra : '')); }
};

console.log('\nAmount in words — Indian numbering, matched to the reference note');
const w = BoughtNote._amountInWords;
ok('reference note amount, verbatim',
   w(985280) === 'NINE LAKH EIGHTY FIVE THOUSAND TWO HUNDRED AND EIGHTY RUPEES', w(985280));
ok('plain hundreds use AND', w(285) === 'TWO HUNDRED AND EIGHTY FIVE RUPEES', w(285));
ok('round hundred has no AND', w(300) === 'THREE HUNDRED RUPEES', w(300));
ok('crore composes', w(12345678) === 'ONE CRORE TWENTY THREE LAKH FORTY FIVE THOUSAND SIX HUNDRED AND SEVENTY EIGHT RUPEES', w(12345678));
ok('zero', w(0) === 'ZERO RUPEES', w(0));
ok('paise appended', w(498069.4) === 'FOUR LAKH NINETY EIGHT THOUSAND SIXTY NINE RUPEES AND FORTY PAISE', w(498069.4));
ok('teens', w(119) === 'ONE HUNDRED AND NINETEEN RUPEES', w(119));
ok('exact lakh', w(500000) === 'FIVE LAKH RUPEES', w(500000));

console.log('\nCount per line — the Count field ONLY, never the description');
const lc = BoughtNote._lineCount;
ok('cf_count in item_custom_fields wins',
   lc({ item_custom_fields: [{ api_name: 'cf_count', value: 70 }], description: '103 C' }) === '70');
ok('flattened cf_count accepted', lc({ cf_count: 103.5 }) === '103.5');
ok('description "103 C" is NOT parsed', lc({ description: '103 C' }) === '');
ok('description "106.5 C" is NOT parsed', lc({ description: '106.5 C' }) === '');
ok('no count entered -> blank', lc({ description: 'fresh stock' }) === '' && lc({}) === '');

console.log('\nNote model — built from the real bill payload shape (anonymised)');
// Shape taken verbatim from a live AVMF farmer-purchase bill.
const BILL = {
  bill_id: '1', bill_number: 'AVMF(P)/26-27/76', date: '2026-04-14',
  vendor_id: 'v1', vendor_name: 'P. Satyanarayana',
  tds_percent: '0.00', tds_amount: 0, tds_summary: [],
  total: 498069, adjustment: -0.4,
  billing_address: { address: '', city: '', state: '' },
  line_items: [
    { name: 'Vannamei Stock', description: '103 C', quantity: 1098.8, rate: 257,
      item_total: 282391.6,
      item_custom_fields: [{ api_name: 'cf_count', value: 103 }] },
    { name: 'Vannamei Stock', description: '106.5 C', quantity: 850.8, rate: 253.5,
      item_total: 215677.8,
      item_custom_fields: [{ api_name: 'cf_count', value: 106.5 }] }
  ]
};
const VENDOR = { contact_name: 'P. Satyanarayana', pan_no: 'ACOPD7001N',
  billing_address: { address: 'Main Road', city: 'Kakinada', state: 'Andhra Pradesh' } };
const ORG = { name: 'Zylker Exports Pvt Ltd', gst_no: '37AAAAA0000A1Z5' };

const n = BoughtNote.build(BILL, VENDOR, ORG);
ok('bill number carried', n.billNo === 'AVMF(P)/26-27/76');
ok('supplier from the bill', n.supplier === 'P. Satyanarayana');
ok('PAN from the vendor contact', n.pan === 'ACOPD7001N');
ok('address joined from the vendor', n.address === 'Main Road, Kakinada, Andhra Pradesh', n.address);
ok('company header from the organization', n.company.name === 'Zylker Exports Pvt Ltd'
   && n.company.gstin === '37AAAAA0000A1Z5');
ok('two lines mapped', n.lines.length === 2);
ok('counts from the Count field', n.lines[0].count === '103' && n.lines[1].count === '106.5');
ok('quantities summed', Math.abs(n.totalQty - 1949.6) < 1e-9, n.totalQty);
ok('no TDS: gross equals the bill total', n.total === 498069, n.total);
ok('TDS defaults to the 0.1 % line with zero amount', n.tdsPercent === 0.1 && n.tdsAmount === 0);
ok('payable is the bill total (already net of TDS in Books)', n.payable === 498069);
ok('date prints dd-mm-yyyy', n.billDate === '14-04-2026', n.billDate);
ok('formatDate passes non-ISO strings through', BoughtNote._formatDate('09-09-2026') === '09-09-2026');
ok('words computed for the payable', /FOUR LAKH NINETY EIGHT THOUSAND SIXTY NINE RUPEES/.test(n.amountWords), n.amountWords);
ok('empty bill detected', BoughtNote.isEmpty(BoughtNote.build({}, null, null)) === true);
ok('this note is not empty', BoughtNote.isEmpty(n) === false);

console.log('\nTDS read from the bill when Books holds it');
const BILL_TDS = Object.assign({}, BILL, { tds_percent: '0.10', tds_amount: 498.07 });
const nt = BoughtNote.build(BILL_TDS, VENDOR, ORG);
ok('percent from the bill', nt.tdsPercent === 0.1, nt.tdsPercent);
ok('amount from the bill', nt.tdsAmount === 498.07);
// Proven live: Books' bill total is ALREADY net of TDS. The note's gross
// Total row is payable + TDS; subtracting again double-deducted it.
ok('payable is the bill total, untouched', nt.payable === 498069, nt.payable);
ok('gross total reconstructed as payable + TDS',
   Math.abs(nt.total - 498567.07) < 1e-9, nt.total);

console.log('\nCompany fallback — internal org constants when context is bare');
const bare = BoughtNote.build(BILL, null, null);
ok('name falls back to Adivishnu', /Adivishnu Marine Foods/.test(bare.company.name));
ok('GSTIN falls back to the verified value', bare.company.gstin === '37AAXCA3167E1ZC');
ok('context org still wins when present', n.company.name === 'Zylker Exports Pvt Ltd');

console.log('\nZFClient request shapes — the proven url_param contract');
const zbox = { console, Object, Promise, ZFAPPS: undefined, window: {}, document: { referrer: '' } };
zbox.window.document = zbox.document;
vm.createContext(zbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'zf-client.js'), 'utf8'), zbox,
                { filename: 'zf-client.js' });
const ZFC = zbox.ZFClient;
const shapes = ZFC._shapes('ac__in_test_getbill', { bill_id: '9', organization_id: '1' });
ok('two shapes: url_param lead plus flat fallback', shapes.length === 2, shapes.length);
ok('lead shape is a plain url_param object',
   shapes[0].name === 'conn+url_param' && shapes[0].arg.url_param
   && !Array.isArray(shapes[0].arg.url_param)
   && shapes[0].arg.url_param.bill_id === '9');
ok('values are strings', Object.values(shapes[0].arg.url_param).every(v => typeof v === 'string'));
ok('connection named on every shape',
   shapes.every(s => s.arg.connection_link_name === 'zbooksbn'));
ok('no arrays anywhere (drew "JSON is not well formed" live)',
   shapes.every(s => !Array.isArray(s.arg.url_param) && !Array.isArray(s.arg.url_query)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
