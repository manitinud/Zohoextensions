/*
 * Verifies the one claim the whole design rests on: that the e-invoice band
 * really does repeat at the top of every printed page.
 *
 * Renders a deliberately multi-page invoice to PDF in Chromium, then extracts
 * text page by page and asserts the IRN, Ack No. and QR appear on each one.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const { chromium } = require(path.join(SCRATCH, 'playwright'));
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

const sandbox = { console, module: {}, exports: {}, unescape, encodeURIComponent };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'print-doc.js'), 'utf8'), sandbox);
const { PrintDoc } = sandbox;

const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'invoice.json'), 'utf8'));

// Blow the invoice up to ~70 line items so it must break across several pages.
const invoice = JSON.parse(JSON.stringify(base));
invoice.line_items = [];
for (let i = 1; i <= 70; i++) {
  invoice.line_items.push({
    name: `Test Article ${i} — 24 pack`,
    description: i % 3 === 0 ? `Article No.${4910000 + i}\nBatch B${i}` : '',
    hsn_or_sac: '96190010', unit: 'box', quantity: i, rate: 1243.2,
    tax_percentage: 12, item_total: +(i * 1243.2).toFixed(2)
  });
}

const IRN = 'a5c12b9f8e4d7361a0b8f2c5d9e14738bc6a0f25d13e847956ab0cd2ef419a63';
const ACK = '112420098765432';

// A real 1x1 PNG so the <img> resolves and occupies header space.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlE'
          + 'QVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const html = PrintDoc.build({
  invoice,
  org: { name: 'Mallikarjuna Enterprises', gst_no: '29AAAAA0000A1Z5', address: {} },
  einvoice: { irn: IRN, ackNo: ACK, ackDate: '2026-08-26 12:42:00', status: 'Pushed',
              qrLink: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-abc' },
  qrDataUri: PNG,
  settings: {
    header: { showQr: true, showIrn: true, showAck: true, showGstin: true, showStatus: true,
              showPageNumbers: true },
    qrSizePx: 150
  },
  docTitle: 'Tax Invoice (e-Invoice)'
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  const pdfPath = path.join(__dirname, 'out-multipage.pdf');
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true,
                   margin: { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' } });

  // Count the rendered header bands directly in the paginated output.
  await browser.close();

  const pdfjs = await import(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)),
                                        useSystemFonts: true }).promise;

  console.log(`\nRendered ${doc.numPages} pages from ${invoice.line_items.length} line items\n`);
  let fail = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const text = tc.items.map(i => i.str).join('');
    const hasIrn = text.includes(IRN);
    const hasAck = text.includes(ACK);
    const hasTitle = text.includes('TAX INVOICE') || /Tax Invoice/i.test(text);
    const okPage = hasIrn && hasAck;
    if (!okPage) fail++;
    console.log(`  page ${String(p).padStart(2)}  IRN:${hasIrn ? 'yes' : 'NO '}  `
              + `Ack:${hasAck ? 'yes' : 'NO '}  band-title:${hasTitle ? 'yes' : 'NO '}  `
              + `${okPage ? 'ok' : 'FAIL'}`);
  }

  if (doc.numPages < 2) { console.log('\nFAIL: fixture did not span multiple pages'); process.exit(1); }
  console.log(`\n${doc.numPages - fail}/${doc.numPages} pages carry the e-invoice band\n`);
  process.exit(fail ? 1 : 0);
})();
