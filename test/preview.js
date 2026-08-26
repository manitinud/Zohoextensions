/*
 * Visual check of the printed document.
 *
 * The extension does not generate QR codes — it embeds the image Zoho Books
 * serves at einvoice_details.qr_link. To preview the layout without a live Books
 * session, this script stands in for that endpoint by rendering an equivalent
 * QR locally (dev dependency only, never shipped) and passing it in exactly the
 * way QRImage.fetchQr would: as an inlined data URI.
 *
 * Writes test/preview-page1.png and test/preview-page2.png.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const { chromium } = require(path.join(SCRATCH, 'playwright'));
const qrcode = require(path.join(SCRATCH, 'qrcode-generator'));
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

const sandbox = { console, module: {}, exports: {}, unescape, encodeURIComponent };
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'print-doc.js'), 'utf8'), sandbox);
const { PrintDoc } = sandbox;

// Real e-invoice values from a live Books organization (SURIE POLEX, BT/25-26/1312).
const IRN = '53801fe38316ea9f7eb31b1a0074f8952378ba1eb4aa6b5c46815a92f95d5ff0';
const ACK = '152625262386743';
const QR_LINK = 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c64ec31e38951c2c37f';

/* Stand-in for the image Books serves at qr_link. */
function fakeBooksQrPng() {
  const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jws = [
    b64u({ alg: 'RS256', typ: 'JWT' }),
    b64u({ data: JSON.stringify({
      SellerGstin: '37AAAAA0000A1Z5', BuyerGstin: '37AACCM4684P1ZN',
      DocNo: 'BT/25-26/1312', DocTyp: 'INV', DocDt: '31/03/2026',
      TotInvVal: '47150.00', Irn: IRN, IrnDt: '2026-04-02 11:18:00' }) }),
    require('crypto').randomBytes(256).toString('base64url')
  ].join('.');

  const qr = qrcode(0, 'L');
  qr.addData(jws, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, scale = 4, W = (n + quiet * 2) * scale;

  // Minimal PNG writer so this needs no canvas dependency.
  const zlib = require('zlib');
  const rows = [];
  for (let y = 0; y < W; y++) {
    const row = Buffer.alloc(1 + W * 3, 0xff);
    row[0] = 0;
    for (let x = 0; x < W; x++) {
      const r = Math.floor(y / scale) - quiet, c = Math.floor(x / scale) - quiet;
      if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) {
        row[1 + x * 3] = row[2 + x * 3] = row[3 + x * 3] = 0;
      }
    }
    rows.push(row);
  }
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32
      ? zlib.crc32(body) >>> 0
      : require('buffer').constants && crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  // Node 22 has zlib.crc32; fall back to a local table if not.
  function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = (crc ^ buf[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'invoice.json'), 'utf8'));
const invoice = JSON.parse(JSON.stringify(base));
invoice.invoice_number = 'BT/25-26/1312';
invoice.line_items = [];
for (let i = 1; i <= 40; i++) {
  invoice.line_items.push({
    name: `Test Article ${i} — 24 pack`,
    description: i % 3 === 0 ? `Article No.${4910000 + i}` : '',
    hsn_or_sac: '96190010', unit: 'box', quantity: i, rate: 1243.2,
    tax_percentage: 12, item_total: +(i * 1243.2).toFixed(2)
  });
}

(async () => {
  const qrDataUri = fakeBooksQrPng();
  console.log(`\nStand-in Books QR image: ${Math.round(qrDataUri.length / 1024)}KB data URI`);

  const html = PrintDoc.build({
    invoice,
    org: { name: 'Surie Polex Distributor', gst_no: '37AAAAA0000A1Z5',
           address: { address: '12-3-45 Market Road', city: 'Ongole', state: 'Andhra Pradesh',
                      zip: '523001', country: 'India' } },
    einvoice: { irn: IRN, ackNo: ACK, ackDate: '2026-04-02 11:18:00', status: 'Pushed',
                qrLink: QR_LINK },
    qrDataUri,
    qrRemoteUrl: QR_LINK,
    settings: { header: { showQr: true, showIrn: true, showAck: true, showGstin: true,
                          showStatus: true, showPageNumbers: true }, qrSizePx: 150 },
    docTitle: 'Tax Invoice (e-Invoice)'
  });

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });

  const pdfPath = path.join(__dirname, 'preview.pdf');
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true,
                   margin: { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' } });

  const viewer = await browser.newPage();
  await viewer.setViewportSize({ width: 900, height: 1200 });
  const pdfB64 = fs.readFileSync(pdfPath).toString('base64');
  await viewer.setContent('<body style="margin:0"></body>');
  const pdfSrc = fs.readFileSync(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  await viewer.evaluate(async ({ src, worker }) => {
    const mk = s => URL.createObjectURL(new Blob([s], { type: 'text/javascript' }));
    window.pdfjsLib = await import(mk(src));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = mk(worker);
  }, { src: pdfSrc, worker: workerSrc });

  for (const p of [1, 2]) {
    const dataUrl = await viewer.evaluate(async ({ b64, pageNo }) => {
      const lib = window.pdfjsLib;
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const doc = await lib.getDocument({ data: arr, useSystemFonts: true }).promise;
      const pg = await doc.getPage(pageNo);
      const vp = pg.getViewport({ scale: 1.6 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c.toDataURL('image/png');
    }, { b64: pdfB64, pageNo: p });
    fs.writeFileSync(path.join(__dirname, `preview-page${p}.png`),
                     Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote test/preview-page${p}.png`);
  }
  await browser.close();
})();
