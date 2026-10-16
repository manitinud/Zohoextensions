/*
 * Renders a Bought Note with the real BNPdf module and reads the PDF back,
 * asserting both copies carry the full note — header, supplier block, lines,
 * totals, TDS, amount in words, signatures — and that long bills paginate
 * with totals only on the last page.
 *
 * Writes test/note-page1.png for eyeballing.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const APP = path.join(__dirname, '..', 'extension', 'app', 'js');

// bn-pdf + boughtnote in THIS realm (pdf-lib instanceof checks break in vm).
function loadModule(file, globals, exportName) {
  const names = Object.keys(globals);
  const body = fs.readFileSync(file, 'utf8') + '\n; return ' + exportName + ';';
  return new Function(...names, body)(...names.map(n => globals[n]));
}
const PDFLib = require(path.join(SCRATCH, 'pdf-lib'));
const BoughtNote = loadModule(path.join(APP, 'boughtnote.js'), {}, 'BoughtNote');
const BNPdf = loadModule(path.join(APP, 'bn-pdf.js'), { PDFLib }, 'BNPdf');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  <- ' + extra : '')); }
};

const BILL = {
  bill_id: '1', bill_number: 'ZYL(P)/26-27/76', date: '2026-04-14',
  vendor_name: 'P. Satyanarayana', tds_percent: '0.10', tds_amount: 498.07,
  total: 498069,
  line_items: [
    { name: 'Vannamei Stock', quantity: 1098.8, rate: 257, item_total: 282391.6,
      item_custom_fields: [{ api_name: 'cf_count', value: 103 }] },
    { name: 'Vannamei Stock', quantity: 850.8, rate: 253.5, item_total: 215677.8,
      item_custom_fields: [{ api_name: 'cf_count', value: 106.5 }] }
  ]
};
const VENDOR = { pan_no: 'AAAAA0000A',
  billing_address: { address: 'Main Road', city: 'Kakinada' } };
const ORG = { name: 'ZYLKER EXPORTS PVT LTD', gst_no: '37AAAAA0000A1Z5' };

(async () => {
  const note = BoughtNote.build(BILL, VENDOR, ORG);
  const bytes = await BNPdf.render(note);
  fs.writeFileSync(path.join(__dirname, 'note.pdf'), Buffer.from(bytes));

  const pdfjs = await import(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  ok('short bill fits one page', doc.numPages === 1, doc.numPages);

  const text = (await (await doc.getPage(1)).getTextContent())
    .items.map(i => i.str).join(' ');

  ok('both copies labelled', text.includes('Original') && text.includes('Duplicate'));
  const twice = s => (text.split(s).length - 1) >= 2;
  ok('company header on both copies', twice('ZYLKER EXPORTS PVT LTD'), text.slice(0, 200));
  ok('BOUGHT NOTE title on both copies', twice('BOUGHT NOTE'));
  ok('GSTIN printed', twice('37AAAAA0000A1Z5'));
  ok('bill number printed', twice('ZYL(P)/26-27/76'));
  ok('supplier printed', twice('P. Satyanarayana'));
  ok('PAN printed', twice('AAAAA0000A'));
  ok('counts printed', twice('103.00') && twice('106.50'));
  ok('quantities printed to 3dp', twice('1098.800') && twice('850.800'));
  ok('total qty printed', twice('1949.600'));
  ok('gross total printed (payable + TDS)', twice('498567.07'));
  ok('TDS line printed', twice('Less TDS @ 0.1 %') && twice('498.07'));
  ok('payable printed - the bill total, net of TDS', twice('498069.00'));
  ok('amount in words printed', twice('FOUR LAKH NINETY EIGHT THOUSAND'));
  ok('signature band printed', twice('Supplier Signature') && twice('Checked By')
     && twice('Authorized Sign'));

  // Pagination: 30 lines must spread over pages, totals only on the last.
  const LONG = Object.assign({}, BILL, {
    line_items: Array.from({ length: 30 }, (_, i) => (
      { name: 'Vannamei Stock', quantity: 100, rate: 250, item_total: 25000,
        item_custom_fields: [{ api_name: 'cf_count', value: 70 + i }] }))
  });
  const longNote = BoughtNote.build(LONG, VENDOR, ORG);
  const longBytes = await BNPdf.render(longNote);
  const longDoc = await pdfjs.getDocument({ data: new Uint8Array(longBytes) }).promise;
  const wantPages = Math.ceil(30 / BNPdf.ROWS_PER_PAGE);
  ok('long bill paginates', longDoc.numPages === wantPages, longDoc.numPages);
  const firstText = (await (await longDoc.getPage(1)).getTextContent())
    .items.map(i => i.str).join(' ');
  const lastText = (await (await longDoc.getPage(longDoc.numPages)).getTextContent())
    .items.map(i => i.str).join(' ');
  ok('header repeats on every page', firstText.includes('BOUGHT NOTE'));
  ok('earlier pages say continued', firstText.includes('Continued'));
  ok('grid labels on every page, amounts only on the last',
     firstText.includes('Amount Payable After')
     && !firstText.includes('498069.00')
     && lastText.includes('498069.00'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
