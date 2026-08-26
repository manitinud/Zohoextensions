/* Unit tests for the pure-logic modules, run against real Zoho Books payloads. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

// pdf-stamp needs a PDFLib global and browser atob; supply both.
const sandbox = {
  console, module: {}, exports: {}, unescape, encodeURIComponent,
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  Uint8Array, Promise, PDFLib: require(path.join(SCRATCH, 'pdf-lib'))
};
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['einvoice.js', 'qr-image.js', 'pdf-stamp.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const { EInvoice, QRImage, PDFStamp } = sandbox;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  <- ' + extra : '')); }
};

console.log('\nEInvoice._read (verbatim einvoice_details from live orgs)');
// Adivishnu Marine Foods, invoice AVMF/PC/INV/006.
const REAL = {
  inv_ref_num: '56261ce5227241efb114a6d60617be398be0923f8fa39fec330407ce110be1ef',
  status_formatted: 'Pushed',
  ack_number: '112631363872267',
  status: 'pushed',
  formatted_status: 'Pushed',
  ack_date: '2026-07-09 11:12:00'
};
const read = EInvoice._read(REAL);
ok('IRN comes from inv_ref_num', read.irn === REAL.inv_ref_num, read.irn);
ok('ack number', read.ackNo === '112631363872267', read.ackNo);
ok('ack date', read.ackDate === '2026-07-09 11:12:00', read.ackDate);
ok('status prefers formatted', read.status === 'Pushed', read.status);

// Surie Polex, invoice BT/25-26/1312 — the detail payload also carries qr_link.
const WITH_QR = Object.assign({}, REAL, {
  qr_link: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c'
});
ok('qr link read', EInvoice._read(WITH_QR).qrLink === WITH_QR.qr_link);
ok('list payload without qr_link', EInvoice._read(REAL).qrLink === null);
ok('alternate irn key accepted', EInvoice._read({ irn: 'ALT' }).irn === 'ALT');
ok('empty details -> nulls', EInvoice._read({}).irn === null);
ok('undefined details -> nulls', EInvoice._read(undefined).irn === null);
ok('isEmpty true for blank', EInvoice._isEmpty(EInvoice._read({})) === true);
ok('isEmpty false when populated', EInvoice._isEmpty(read) === false);

console.log('\nQRImage._toDataUri');
ok('passes data URIs through',
   QRImage._toDataUri('data:image/png;base64,AAAA') === 'data:image/png;base64,AAAA');
ok('wraps bare base64 as png',
   QRImage._toDataUri('A'.repeat(80)).startsWith('data:image/png;base64,AAA'));
ok('detects jpeg prefix',
   QRImage._toDataUri('/9j/' + 'A'.repeat(80)).startsWith('data:image/jpeg;base64,'));
ok('rejects a URL', QRImage._toDataUri('https://books.zoho.in/einvoice/qrcode?x=1') === null);
ok('rejects empty', QRImage._toDataUri('') === null);

console.log('\nPDFStamp helpers');
const irn = REAL.inv_ref_num;
ok('IRN wraps rather than overflowing', PDFStamp._chunk(irn, 46).length === 2);
ok('chunks rejoin losslessly', PDFStamp._chunk(irn, 46).join('') === irn);
ok('short value stays one line', PDFStamp._chunk('abc', 46).length === 1);
ok('base64 decodes to bytes', PDFStamp._base64ToBytes('AAEC').length === 3);
ok('strips a data: prefix',
   PDFStamp._base64ToBytes('data:image/png;base64,AAEC').length === 3);
ok('tolerates whitespace', PDFStamp._base64ToBytes('AA EC\n').length === 3);

console.log('\nZFClient data-centre resolution');
// hostDomain/candidateBases read browser globals, so exercise them in a stub DOM.
function basesFor(hostUrl) {
  const box = {
    console, URL, Object,
    document: { referrer: hostUrl },
    window: { location: { ancestorOrigins: { length: 0 } } }
  };
  box.window.document = box.document;
  Object.assign(box, { ZFAPPS: undefined });
  box.window.URL = URL;
  vm.createContext(box);
  box.window.location = { ancestorOrigins: { length: 0 } };
  vm.runInContext(
    fs.readFileSync(path.join(APP, 'zf-client.js'), 'utf8').replace(/^var ZFClient/, 'var ZFClient'),
    box, { filename: 'zf-client.js' });
  return box.ZFClient._candidateBases();
}
const inBases = basesFor('https://books.zoho.in/app');
ok('india org hits zohoapis.in first',
   inBases[0] === 'https://www.zohoapis.in/books/v3/', inBases[0]);
const comBases = basesFor('https://books.zoho.com/app');
ok('us org hits zohoapis.com first',
   comBases[0] === 'https://www.zohoapis.com/books/v3/', comBases[0]);
const auBases = basesFor('https://books.zoho.com.au/app');
ok('australia org hits zohoapis.com.au first',
   auBases[0] === 'https://www.zohoapis.com.au/books/v3/', auBases[0]);
ok('unknown host still yields candidates', basesFor('https://example.com/').length > 1);
ok('every data centre remains reachable as a fallback', inBases.length === 8);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
