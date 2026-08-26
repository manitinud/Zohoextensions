/*
 * Verifies the claim the extension now rests on: the organization's own invoice
 * PDF comes back with the e-invoice band on EVERY page, and its own artwork
 * intact.
 *
 * A stand-in "client template" PDF is produced in Chromium (branded header,
 * many line items, so it spans several pages), stamped with the real
 * PDFStamp module, then read back page by page — asserting the IRN and Ack No.
 * appear on each page AND that the client's own text is still there.
 *
 * Writes test/stamped-page1.png / stamped-page2.png for eyeballing.
 */
const fs = require('fs'), path = require('path');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const { chromium } = require(path.join(SCRATCH, 'playwright'));
const qrcode = require(path.join(SCRATCH, 'qrcode-generator'));
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

/*
 * Load pdf-stamp.js in THIS realm, not a vm sandbox. pdf-lib does instanceof
 * checks on Array, and array literals created inside a vm context belong to a
 * different realm, so they fail those checks. A browser has only one realm, so
 * sandboxing here would be testing a condition that never occurs in production.
 */
function loadModule(file, globals) {
  const names = Object.keys(globals);
  const body = fs.readFileSync(file, 'utf8') + '\n; return PDFStamp;';
  return new Function(...names, body)(...names.map(n => globals[n]));
}
const PDFStamp = loadModule(path.join(APP, 'pdf-stamp.js'), {
  PDFLib: require(path.join(SCRATCH, 'pdf-lib')),
  atob: s => Buffer.from(s, 'base64').toString('binary')
});

const IRN = '56261ce5227241efb114a6d60617be398be0923f8fa39fec330407ce110be1ef';
const ACK = '112631363872267';
const CLIENT_MARK = 'ADIVISHNU MARINE FOODS PVT LTD';

/* Stand-in for the QR image Zoho Books serves at qr_link. */
function qrPngBase64() {
  const zlib = require('zlib');
  const qr = qrcode(0, 'L');
  qr.addData('eyJhbGciOiJSUzI1NiJ9.' + 'x'.repeat(700) + '.sig', 'Byte');
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, scale = 4, W = (n + quiet * 2) * scale;
  const rows = [];
  for (let y = 0; y < W; y++) {
    const row = Buffer.alloc(1 + W * 3, 0xff); row[0] = 0;
    for (let x = 0; x < W; x++) {
      const r = Math.floor(y / scale) - quiet, c = Math.floor(x / scale) - quiet;
      if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) {
        row[1 + x * 3] = row[2 + x * 3] = row[3 + x * 3] = 0;
      }
    }
    rows.push(row);
  }
  function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = (crc ^ buf[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]).toString('base64');
}

/* A branded, multi-page invoice standing in for the client's Books template. */
function clientTemplateHtml() {
  let rows = '';
  for (let i = 1; i <= 55; i++) {
    rows += `<tr><td>${i}</td><td>Finished Product (Vannamei Stock) grade ${i}</td>`
          + `<td>030617</td><td>18,360 kg</td><td>5.15</td><td>94,554.00</td></tr>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 12mm; }
    body { font: 11px/1.4 Arial, sans-serif; }
    .brand { border-bottom: 3px solid #14507d; padding-bottom: 8px; margin-bottom: 12px; }
    .brand h1 { color: #14507d; font-size: 17px; margin: 0; letter-spacing: .5px; }
    .brand p { margin: 2px 0 0; color: #555; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #14507d; color: #fff; padding: 5px; font-size: 10px; }
    td { border: 1px solid #ccc; padding: 4px 5px; }
  </style></head><body>
    <div class="brand"><h1>${CLIENT_MARK}</h1>
      <p>Plot No. D14, Sy No. 209, Kakinada SEZ Limited, Andhra Pradesh 533448</p></div>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th>
      <th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.setContent(clientTemplateHtml(), { waitUntil: 'networkidle' });
  const clientPdf = await page.pdf({ format: 'A4', printBackground: true });
  fs.writeFileSync(path.join(__dirname, 'client-template.pdf'), clientPdf);

  const stamped = await PDFStamp.stamp({
    pdfBytes: new Uint8Array(clientPdf),
    einvoice: { irn: IRN, ackNo: ACK, ackDate: '2026-07-09 11:12:00', status: 'Pushed' },
    qrPngBase64: qrPngBase64(),
    showStatus: true
  });
  const outPath = path.join(__dirname, 'stamped.pdf');
  fs.writeFileSync(outPath, Buffer.from(stamped));

  const pdfjs = await import(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const before = await pdfjs.getDocument({ data: new Uint8Array(clientPdf) }).promise;
  const after = await pdfjs.getDocument({ data: new Uint8Array(stamped) }).promise;

  console.log(`\nclient template: ${before.numPages} pages`
            + `  ->  stamped: ${after.numPages} pages`);
  console.log(`size: ${Math.round(clientPdf.length / 1024)}KB -> `
            + `${Math.round(stamped.length / 1024)}KB\n`);

  let fail = 0;
  if (after.numPages !== before.numPages) {
    console.log('  FAIL page count changed'); fail++;
  }
  if (before.numPages < 2) { console.log('  FAIL fixture is not multi-page'); fail++; }

  for (let p = 1; p <= after.numPages; p++) {
    const text = (await (await after.getPage(p)).getTextContent())
      .items.map(i => i.str).join('');
    const hasIrn = text.includes(IRN);
    const hasAck = text.includes(ACK);
    const hasClient = text.includes('Vannamei') || text.includes(CLIENT_MARK);
    const good = hasIrn && hasAck && hasClient;
    if (!good) fail++;
    console.log(`  page ${String(p).padStart(2)}  IRN:${hasIrn ? 'yes' : 'NO '}  `
              + `Ack:${hasAck ? 'yes' : 'NO '}  client-content:${hasClient ? 'yes' : 'NO '}  `
              + `${good ? 'ok' : 'FAIL'}`);
  }

  // Page images for eyeballing.
  const viewer = await browser.newPage();
  await viewer.setViewportSize({ width: 900, height: 1200 });
  await viewer.setContent('<body style="margin:0"></body>');
  const src = fs.readFileSync(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'), 'utf8');
  const wk = fs.readFileSync(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  await viewer.evaluate(async ({ s, w }) => {
    const mk = t => URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
    window.pdfjsLib = await import(mk(s));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = mk(w);
  }, { s: src, w: wk });
  const b64 = Buffer.from(stamped).toString('base64');
  for (const p of [1, 2]) {
    const d = await viewer.evaluate(async ({ b64, pageNo }) => {
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const doc = await window.pdfjsLib.getDocument({ data: arr, useSystemFonts: true }).promise;
      const pg = await doc.getPage(pageNo);
      const vp = pg.getViewport({ scale: 1.5 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c.toDataURL('image/png');
    }, { b64, pageNo: p });
    fs.writeFileSync(path.join(__dirname, `stamped-page${p}.png`),
                     Buffer.from(d.split(',')[1], 'base64'));
  }
  await browser.close();

  console.log(`\n${after.numPages - fail}/${after.numPages} pages carry the band `
            + `with the client's own content intact\n`);
  process.exit(fail ? 1 : 0);
})();
