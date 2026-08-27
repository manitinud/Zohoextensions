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

console.log('\nZFClient request shapes');
// zf-client touches browser globals at load, so give it a minimal stand-in.
const zbox = {
  console, Object, Promise,
  ZFAPPS: undefined,
  window: {}, document: { referrer: '' }
};
zbox.window.document = zbox.document;
vm.createContext(zbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'zf-client.js'), 'utf8'), zbox,
                { filename: 'zf-client.js' });
const ZFC = zbox.ZFClient;

const shapes = ZFC._shapes('ac__in_test_getinvoice',
  'https://www.zohoapis.in/books/v3/invoices/123?organization_id=9',
  { invoice_id: '123', organization_id: '9' });
ok('several call shapes are attempted', shapes.length >= 5, shapes.length);
ok('the documented sample shape leads: url + config key as connection',
   shapes[0].arg.url && shapes[0].arg.method === 'GET'
   && shapes[0].arg.connection_link_name === 'ac__in_test_getinvoice',
   JSON.stringify(shapes[0].arg));
ok('a zbooks-connection url shape exists',
   shapes.some(x => x.arg.url && x.arg.connection_link_name === 'zbooks'));
ok('the concrete url carries the real invoice id',
   shapes[0].arg.url.indexOf('/invoices/123') !== -1);
ok('legacy configured-call shapes remain as fallback',
   shapes.some(x => !x.arg.url && x.arg.api_configuration_key === 'ac__in_test_getinvoice'
                    && x.arg.invoice_id === '123'));
ok('every shape is named for reporting', shapes.every(s => typeof s.name === 'string'));

console.log('\nZFClient.describe — rejection payloads the SDK actually uses');
// The SDK rejects with plain objects and strings, never Error instances, so
// reading .message threw the reason away and every failure logged identically.
const d = ZFC._describe;
ok('plain string reason', d('invalid parameters') === 'invalid parameters');
ok('Error instance', d(new Error('boom')) === 'boom');
ok('object with message', d({ message: 'no such configuration' }) === 'no such configuration');
ok('object with code and error',
   /code=57/.test(d({ code: 57, error: 'not authorized' })), d({ code: 57, error: 'not authorized' }));
ok('object with status_code', /status_code=401/.test(d({ status_code: 401 })));
ok('unknown object falls back to JSON',
   /"foo"/.test(d({ foo: 'bar' })), d({ foo: 'bar' }));
ok('empty object still says something', d({}).length > 0, d({}));
ok('undefined handled', /undefined/.test(d(undefined)), d(undefined));
ok('null handled', /null/.test(d(null)), d(null));
ok('never returns the bare word failed', d({ a: 1 }) !== 'failed');

console.log('\nAPI configuration keys');
ok('details config named', /^ac__.+getinvoice$/.test(ZFC.API.invoice), ZFC.API.invoice);
ok('pdf config named', /^ac__.+getinvoicepdf$/.test(ZFC.API.invoicePdf), ZFC.API.invoicePdf);
ok('qr config named', /^ac__.+geteinvoiceqr$/.test(ZFC.API.einvoiceQr), ZFC.API.einvoiceQr);
ok('the three keys are distinct',
   new Set([ZFC.API.invoice, ZFC.API.invoicePdf, ZFC.API.einvoiceQr]).size === 3);

console.log('\neInvoiceID extraction from a real qr_link');
// The QR endpoint is pinned by its API configuration, so the token has to be
// lifted out of the link Books returns and passed as a parameter.
const QR_LINK = 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c64ec31e389'
              + '51c2c37fa8892c055843686d38d509299c3d4561ea68d434';
const token = /[?&]eInvoiceID=([^&]+)/i.exec(QR_LINK);
ok('token found in qr_link', !!token);
ok('token is the full value',
   token[1] === '2-48da5c64ec31e38951c2c37fa8892c055843686d38d509299c3d4561ea68d434');
ok('no token in a link without one',
   /[?&]eInvoiceID=([^&]+)/i.exec('https://books.zoho.in/einvoice/qrcode') === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
