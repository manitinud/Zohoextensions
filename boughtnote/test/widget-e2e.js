/*
 * Runs the real Bought Note widget in a real browser against a mocked ZFAPPS.
 * Timeouts are shortened via ?fastTimeouts=1 so a run takes seconds.
 */
const fs = require('fs'), path = require('path'), http = require('http');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const { chromium } = require(path.join(SCRATCH, 'playwright-core'));
const { buildMockScript } = require('./mock-zfapps');
const APP_DIR = path.join(__dirname, '..', 'extension', 'app');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('    ok   ' + name); }
  else { fail++; console.log('    FAIL ' + name + (extra !== undefined ? '  <- ' + extra : '')); }
};

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                  '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(APP_DIR, rel || 'widget.html');
    if (!file.startsWith(APP_DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, () => r({ server, port: server.address().port })));
}

async function run(browser, name, scenario, checks) {
  console.log('\n  ' + name);
  const { server, port } = await serve();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(buildMockScript(scenario));
  await page.goto(`http://127.0.0.1:${port}/widget.html?fastTimeouts=1`,
                  { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    () => { const s = document.getElementById('status');
            return s && !/^Loading|^Reading/.test(s.textContent); },
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(scenario.settleMs || 2500);

  const state = await page.evaluate(() => ({
    status: (document.getElementById('status') || {}).textContent || '',
    statusClass: (document.getElementById('status') || {}).className || '',
    details: (document.getElementById('details') || {}).textContent || '',
    diag: (document.getElementById('diag-text') || {}).value || '',
    printDisabled: (document.getElementById('print-btn') || {}).disabled,
    calls: window.__mockCalls || []
  }));

  await checks(state, errors, page);
  ok('no uncaught page errors', errors.length === 0, errors.join(' | '));

  await page.close();
  server.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // 1. Happy path, under the proven live contract: connection named,
  //    url_param object required for substitution.
  await run(browser, 'happy path — url_param contract, vendor PAN resolved',
    { requireConnection: true, requireUrlParam: true },
    (s) => {
      ok('supplier rendered', s.details.includes('P. Satyanarayana'), s.details);
      ok('PAN from the vendor', s.details.includes('AAAAA0000A'));
      ok('payable computed - bill total, net of TDS', s.details.includes('498069.00'), s.details);
      ok('ready to print', /ready to print/i.test(s.status), s.status);
      ok('print enabled', s.printDisabled === false);
      ok('url_param shape won', /accepted shape: conn\+url_param/.test(s.diag),
         (s.diag.match(/accepted shape.*/) || [''])[0]);
    });

  // 2. The bill API fails — the context bill (no line items) cannot print,
  //    and the failure is reported as a failure, not as an empty bill.
  await run(browser, 'bill API fails — reported, not silently empty',
    { requireConnection: true, billApiFails: true, settleMs: 4000 },
    (s) => {
      ok('panel reports the failure or empty state',
         /Could not read|no line items/i.test(s.status), s.status);
      ok('print stays disabled', s.printDisabled === true);
      ok('API error recorded in diagnostics', /bill API error/.test(s.diag));
    });

  // 3. Print produces the Bought Note PDF with both copies.
  await run(browser, 'print produces the Bought Note PDF',
    { requireConnection: true, requireUrlParam: true },
    async (s, errors, page) => {
      await page.evaluate(() => {
        window.__blobBytes = null;
        const realCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function (blob) {
          const fr = new FileReader();
          fr.onload = function () { window.__blobBytes = fr.result; };
          fr.readAsDataURL(blob);
          return realCreate(blob);
        };
        window.open = function () { return { focus() {}, print() {} }; };
      });
      await page.click('#print-btn');
      await page.waitForFunction(() => window.__blobBytes !== null, { timeout: 20000 })
        .catch(() => {});
      const out = await page.evaluate(() => ({
        bytes: window.__blobBytes,
        status: (document.getElementById('status') || {}).textContent || ''
      }));
      ok('a PDF was produced', !!out.bytes && /^data:application\/pdf/.test(out.bytes),
         (out.bytes || '').slice(0, 40));
      ok('status reports readiness', /ready|print or save/i.test(out.status), out.status);
      if (out.bytes) {
        fs.writeFileSync(path.join(__dirname, 'e2e-note.pdf'),
                         Buffer.from(out.bytes.split(',')[1], 'base64'));
        const pdfjs = await import(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'));
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(fs.readFileSync(path.join(__dirname, 'e2e-note.pdf'))) }).promise;
        const text = (await (await doc.getPage(1)).getTextContent())
          .items.map(i => i.str).join(' ');
        ok('both copies in the printed PDF',
           text.includes('Original') && text.includes('Duplicate'));
        ok('cf_count wins over the description where present',
           (text.split('106.50').length - 1) >= 2, text.slice(0, 300));
        ok('amount in words printed',
           text.includes('FOUR LAKH NINETY EIGHT THOUSAND'));
      }
    });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
