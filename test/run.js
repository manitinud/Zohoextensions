/* Node harness: exercises the pure-logic modules with a realistic Books payload. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

const sandbox = { console, module: {}, exports: {}, unescape, encodeURIComponent };
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['print-doc.js', 'einvoice.js', 'qr-image.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const { PrintDoc, EInvoice, QRImage } = sandbox;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  <- ' + extra : '')); }
};

console.log('\namountInWords (Indian numbering)');
const w = PrintDoc._amountInWords;
ok('137296.00', w(137296, 'Rupees') === 'Rupees One Lakh Thirty Seven Thousand Two Hundred and Ninety Six Only', w(137296,'Rupees'));
ok('paise',     w(1234.56, 'Rupees') === 'Rupees One Thousand Two Hundred and Thirty Four and Fifty Six Paise Only', w(1234.56,'Rupees'));
ok('crore',     w(25000000, 'Rupees') === 'Rupees Two Crore Fifty Lakh Only', w(25000000,'Rupees'));
ok('zero',      w(0, 'Rupees') === 'Zero Only', w(0,'Rupees'));
ok('teen',      w(19, 'Rupees') === 'Rupees Nineteen Only', w(19,'Rupees'));

console.log('\nmoney (Indian digit grouping)');
const m = PrintDoc._money;
ok('137296',   m(137296, '') === '1,37,296.00', m(137296,''));
ok('1000',     m(1000, '') === '1,000.00', m(1000,''));
ok('10000000', m(10000000, '') === '1,00,00,000.00', m(10000000,''));
ok('999.5',    m(999.5, '') === '999.50', m(999.5,''));

console.log('\nEInvoice._read (against the shape Zoho Books actually returns)');
// Verbatim einvoice_details from a live e-invoiced org (SURIE POLEX, invoice BT/25-26/1312).
const REAL = {
  is_cancellable: false,
  inv_ref_num: '53801fe38316ea9f7eb31b1a0074f8952378ba1eb4aa6b5c46815a92f95d5ff0',
  status_formatted: 'Pushed',
  ack_number: '152625262386743',
  qr_link: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c64ec31e38951c2c37f',
  status: 'pushed',
  formatted_status: 'Pushed',
  ack_date: '2026-04-02 11:18:00'
};
const read = EInvoice._read(REAL);
ok('IRN comes from inv_ref_num', read.irn === REAL.inv_ref_num, read.irn);
ok('ack number', read.ackNo === '152625262386743', read.ackNo);
ok('ack date', read.ackDate === '2026-04-02 11:18:00', read.ackDate);
ok('status prefers formatted', read.status === 'Pushed', read.status);
ok('qr link', read.qrLink === REAL.qr_link, read.qrLink);

ok('list-shaped payload (no qr_link) still reads',
   EInvoice._read({ inv_ref_num: 'X', ack_number: 'Y', ack_date: 'Z' }).qrLink === null);
ok('alternate irn key accepted', EInvoice._read({ irn: 'ALT' }).irn === 'ALT');
ok('empty details -> all null', EInvoice._read({}).irn === null);
ok('undefined details -> all null', EInvoice._read(undefined).irn === null);
ok('isEmpty true for blank', EInvoice._isEmpty(EInvoice._read({})) === true);
ok('isEmpty false when irn present', EInvoice._isEmpty(EInvoice._read(REAL)) === false);

console.log('\nQRImage._toDataUri');
ok('passes data URIs through',
   QRImage._toDataUri('data:image/png;base64,AAAA') === 'data:image/png;base64,AAAA');
ok('wraps bare base64 as png',
   QRImage._toDataUri('A'.repeat(80)).startsWith('data:image/png;base64,AAA'));
ok('detects jpeg prefix',
   QRImage._toDataUri('/9j/' + 'A'.repeat(80)).startsWith('data:image/jpeg;base64,'));
ok('rejects a URL', QRImage._toDataUri('https://books.zoho.in/einvoice/qrcode?x=1') === null);
ok('rejects empty', QRImage._toDataUri('') === null);

console.log('\nPrintDoc.build');
const invoice = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'invoice.json'), 'utf8'));
const settings = {
  header: { showQr: true, showIrn: true, showAck: true, showGstin: true, showStatus: true,
            showPageNumbers: true },
  qrSizePx: 150
};
const einvoice = {
  irn: 'a5c12b9f8e4d7361a0b8f2c5d9e14738bc6a0f25d13e847956ab0cd2ef419a63',
  ackNo: '112420098765432', ackDate: '2026-08-26 12:42:00', status: 'Pushed',
  qrLink: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-abc'
};
const html = PrintDoc.build({
  invoice, org: { name: 'Mallikarjuna Enterprises', gst_no: '29AAAAA0000A1Z5', address: {} },
  einvoice, qrDataUri: 'data:image/png;base64,AAAA', settings, docTitle: 'Tax Invoice (e-Invoice)'
});
fs.writeFileSync(path.join(__dirname, 'out.html'), html);

ok('is a full document', html.startsWith('<!doctype html>') && html.trim().endsWith('</html>'));
ok('header band lives in <thead>', /<thead><tr><td><div class="einv-band">/.test(html));
ok('thead set to repeat', html.includes('.sheet > thead{display:table-header-group;}'));
ok('IRN in header band', html.includes(einvoice.irn));
ok('Ack No in header band', html.includes('112420098765432'));
ok('QR img inlined', html.includes('src="data:image/png;base64,AAAA"'));
ok('line item rendered', html.includes('Sofy BDYFT XL6'));
ok('HSN rendered', html.includes('96190010'));
ok('total in words', html.includes('Thirty Seven Thousand Two Hundred and Ninety Six'));
ok('grand total grouped', html.includes('₹37,296.00'));

console.log('\nescaping');
const evil = JSON.parse(JSON.stringify(invoice));
evil.customer_name = '<script>alert(1)</script>';
evil.line_items[0].name = '"><img src=x onerror=alert(1)>';
const h2 = PrintDoc.build({ invoice: evil, org: {}, einvoice, qrDataUri: null, settings,
  docTitle: 'T' });
ok('no raw <script> from data', !h2.includes('<script>alert(1)</script>'));
ok('no raw onerror from data', !/<img src=x onerror/.test(h2));
ok('escaped entity present', h2.includes('&lt;script&gt;'));

console.log('\nmissing-QR path');
const h3 = PrintDoc.build({ invoice, org: {}, einvoice: { irn: 'I', ackNo: null, ackDate: null,
  qrLink: null }, qrDataUri: null, qrRemoteUrl: null,
  qrError: 'This invoice has no e-invoice QR on record.', settings, docTitle: 'T' });
ok('renders placeholder not a broken img',
   h3.includes('qr-wrap qr-missing') && !h3.includes('src="null"') && !h3.includes('src="undefined"'));
ok('states the reason', h3.includes('no e-invoice QR on record'));

console.log('\nQR fallback to Books-hosted URL');
const h4 = PrintDoc.build({ invoice, org: {}, einvoice, qrDataUri: null,
  qrRemoteUrl: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-abc', settings, docTitle: 'T' });
ok('uses the remote URL when not inlined',
   h4.includes('src="https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-abc"'));
ok('no missing-QR placeholder in that case', !h4.includes('qr-wrap qr-missing'));
ok('e-invoice status row rendered', h4.includes('Pushed'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
