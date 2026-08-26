/* Node harness: exercises the pure-logic modules with a realistic Books payload. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

const sandbox = { console, module: {}, exports: {}, unescape, encodeURIComponent };
sandbox.window = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['print-doc.js', 'einvoice.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const { PrintDoc, EInvoice } = sandbox;

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

console.log('\nEInvoice._find (alias resolution across key styles)');
const find = EInvoice._find;
ok('PascalCase IRP payload', find({ Irn: 'ABC123' }, ['irn','irnnumber']) === 'ABC123');
ok('Books snake_case',       find({ irn_number: 'X9' }, ['irn','irnnumber']) === 'X9');
ok('nested one level',       find({ einvoice: { AckNo: '112' } }, ['ackno','ack_number']) === '112');
ok('array wrapped',          find([{ SignedQRCode: 'jws' }], ['signedqrcode']) === 'jws');
ok('ignores empty string',   find({ Irn: '' }, ['irn']) === null);
ok('no false positive',      find({ other: 'v' }, ['irn']) === null);
ok('depth capped',           find({a:{b:{c:{d:{e:{f:{Irn:'deep'}}}}}}}, ['irn']) === null);

console.log('\nPrintDoc.build');
const invoice = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'invoice.json'), 'utf8'));
const settings = {
  header: { showQr: true, showIrn: true, showAck: true, showGstin: true, showPageNumbers: true },
  qrSizePx: 150, qrEcLevel: 'L'
};
const einvoice = {
  irn: 'a5c12b9f8e4d7361a0b8f2c5d9e14738bc6a0f25d13e847956ab0cd2ef419a63',
  ackNo: '112420098765432', ackDate: '2026-08-26 12:42:00', signedQr: 'x'.repeat(40)
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
  signedQr: null }, qrDataUri: null, qrError: 'No signed QR on record', settings, docTitle: 'T' });
ok('renders placeholder not a broken img', h3.includes('qr-missing') && !h3.includes('src="null"'));
ok('states the reason', h3.includes('No signed QR on record'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
