/*
 * Runs the real widget in a real browser against a mocked ZFAPPS.
 *
 * The point is to stop testing in a client's production organization. Every
 * scenario here reproduces something actually seen in a live run — an init that
 * never settles, a request that never settles, an invoice with no
 * einvoice_details — so the widget's behaviour under each is settled here
 * rather than on someone's screen.
 *
 * Timeouts are shortened via a URL flag so a run takes seconds, not minutes.
 */
const fs = require('fs'), path = require('path'), http = require('http');
const SCRATCH = '/tmp/claude-0/-home-user-Zohoextensions/81515d70-89fa-57e6-9415-6ab46779037e/scratchpad/node_modules';
const { chromium } = require(path.join(SCRATCH, 'playwright'));
const { buildMockScript } = require('./mock-zfapps');
const APP_DIR = path.join(__dirname, '..', 'extension', 'app');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('    ok   ' + name); }
  else { fail++; console.log('    FAIL ' + name + (extra !== undefined ? '  <- ' + extra : '')); }
};

/* Serve app/ so relative script tags resolve exactly as they do when hosted. */
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

/* A one-page PDF and a small PNG, base64, standing in for what Books returns. */
async function fixtures(browser) {
  const p = await browser.newPage();
  await p.setContent('<h1 style="font:24px Arial">ADIVISHNU MARINE FOODS</h1>'
    + '<p>Client template body — Vannamei Stock</p>');
  const pdf = await p.pdf({ format: 'A4' });
  await p.close();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAE'
            + 'hQGAhKmMIQAAAABJRU5ErkJggg==';
  return { pdfBase64: Buffer.from(pdf).toString('base64'), qrBase64: png };
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
            return s && !/^Loading/.test(s.textContent); },
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
  const fx = await fixtures(browser);

  // 1. Everything works. The panel must show the real IRN and enable printing.
  await run(browser, 'happy path — flat argument shape accepted',
    Object.assign({ acceptShape: 'flat' }, fx),
    (s) => {
      ok('build is reported', /build: v/.test(s.diag), s.diag.split('\n')[0]);
      ok('IRN rendered', s.details.includes('56261ce5227241efb114a6d60617be39'), s.details);
      ok('ack number rendered', s.details.includes('112631363872267'));
      ok('status says ready', /ready to print/i.test(s.status), s.status);
      ok('status styled ok', /status--ok/.test(s.statusClass), s.statusClass);
      ok('print enabled', s.printDisabled === false);
      ok('accepted shape recorded', /accepted shape/.test(s.diag));
    });

  // 2. init never settles — seen live. The widget must carry on regardless.
  await run(browser, 'extension.init hangs',
    Object.assign({ initHangs: true, acceptShape: 'flat' }, fx),
    (s) => {
      ok('does not sit on Loading', !/^Loading/.test(s.status), s.status);
      ok('init timeout reported', /extension\.init.*timed out/i.test(s.diag),
         (s.diag.match(/extension\.init.*/) || [''])[0]);
      ok('details still resolved', s.details.includes('112631363872267'), s.details);
    });

  // 3. Every request hangs — the failure mode that read as a freeze.
  await run(browser, 'every request hangs',
    Object.assign({ requestHangs: true, settleMs: 12000 }, fx),
    (s) => {
      ok('does not sit on Loading', !/^Loading/.test(s.status), s.status);
      ok('reports a failure rather than spinning', /status--(error|warn|info)/.test(s.statusClass));
      ok('all shapes attempted', (s.calls || []).length >= 3, (s.calls || []).length);
      ok('timeouts recorded in diagnostics', /no response within/.test(s.diag),
         s.diag.slice(-200));
    });

  // 4. Only a nested shape is accepted — proves the fallback chain works and
  //    is not just finding the first option by luck.
  await run(browser, 'only url_params shape accepted',
    Object.assign({ acceptShape: 'url_params', settleMs: 8000 }, fx),
    (s) => {
      ok('still resolves the details', s.details.includes('112631363872267'), s.details);
      ok('records a url_params-bearing winner', /accepted shape: .*(url_params)/.test(s.diag),
         (s.diag.match(/accepted shape.*/) || [''])[0]);
    });

  // 4a2. The exact failure seen live: request rejects fast with a plain object,
  //      not an Error. The reason must reach the panel verbatim — the word
  //      'failed' alone means the payload was discarded again.
  await run(browser, 'request rejects with a plain object — reason surfaces',
    Object.assign({ requestRejectsWith: { code: 57, message: 'You are not authorized to perform this operation' },
                    getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('Zoho reason reaches diagnostics',
         /not authorized/.test(s.diag), (s.diag.match(/flat.*/) || [''])[0]);
      ok('panel error carries the reason too', /not authorized/.test(s.status), s.status);
      ok('no bare failed entries', !/: failed( \|||$)/.test(s.diag));
    });

  await run(browser, 'request rejects with a bare string — reason surfaces',
    Object.assign({ requestRejectsWith: 'Extension is not authorized to access this API',
                    getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('string reason reaches diagnostics',
         /not authorized to access/.test(s.diag), (s.diag.match(/flat.*/) || [''])[0]);
    });

  // 4a3. SDK 2.0 live behaviour: connection-less calls rejected. The
  //      connection-bearing shapes must win.
  await run(browser, 'SDK 2.0 requires the connection named in the call',
    Object.assign({ requireConnection: true, getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('details resolved', s.details.includes('112631363872267'), s.details);
      ok('a connection-bearing shape won',
         /accepted shape: (url\+.*|conn\w*)/.test(s.diag) && /zbooks|cfgkey|conn/.test(s.diag),
         (s.diag.match(/accepted shape.*/) || [''])[0]);
    });

  // 4a4. Books app-level error inside HTTP 200 (code 4, placeholder not
  //      substituted). Must fail that shape and let a flat-value shape win —
  //      and must never masquerade as an invoice with no e-invoice.
  await run(browser, 'Books code-4 body fails the shape, flat values win',
    Object.assign({ booksCodeUnlessFlat: true, getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('details resolved via a flat-value shape',
         s.details.includes('112631363872267'), s.details);
      ok('the code-4 reason is logged',
         /Invalid value passed for invoice_id/.test(s.diag),
         (s.diag.match(/url_params.*/) || [''])[0]);
      ok('raw api body traced', /api body: .*invoice/.test(s.diag),
         (s.diag.match(/api body.*/) || [''])[0].slice(0, 120));
    });

  // 4c. When the invoice already carries the data, no call should be needed.
  await run(browser, 'e-invoice data already in the invoice context',
    Object.assign({ einvoiceInContext: true, requestHangs: true, getRecordHangs: true }, fx),
    (s) => {
      ok('details resolved from the invoice itself',
         s.details.includes('112631363872267'), s.details);
      ok('no record lookup attempted', !/getRecord\//.test(s.diag),
         (s.diag.match(/getRecord.*/) || [''])[0]);
      ok('scan reported what it found', /einvoice-ish keys in invoice: [1-9]/.test(s.diag),
         (s.diag.match(/einvoice-ish keys.*/) || [''])[0]);
    });

  // 5. The deliverable itself: click Print and confirm a stamped PDF is
  //    produced from the client's own PDF, with the band on the page. This
  //    path had never been exercised end to end.
  await run(browser, 'SDK 2.0 direct payloads — details resolve',
    Object.assign({ directPayload: true, requireConnection: true,
                    getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('details resolved from a direct payload',
         s.details.includes('112631363872267'), s.details);
      ok('success log names the payload', /ok \(keys: code,message,invoice\)/.test(s.diag),
         (s.diag.match(/: ok.*/) || [''])[0]);
    });

  // The SDK's signature failure is hanging; an unknown dotted path hanging
  //      must never stall resolution while the API can still answer.
  await run(browser, 'unknown-path get hangs — API route still wins',
    Object.assign({ unknownGetHangs: true, exchangeRecord: true,
                    requireConnection: true, getRecordHangs: true, settleMs: 5000 }, fx),
    (s) => {
      ok('details resolved despite hanging gets',
         s.details.includes('112631363872267'), s.details);
    });

  await run(browser, 'dotted-path get supplies the details directly',
    Object.assign({ pathGetWorks: true, requestHangs: true,
                    getRecordHangs: true, settleMs: 5000 }, fx),
    (s) => {
      ok('details from the page itself', s.details.includes('112631363872267'), s.details);
      ok('trace names the winning path', /get\(invoice\.einvoice_details\): .*inv_ref_num/.test(s.diag),
         (s.diag.match(/get\(invoice.*/) || [''])[0]);
    });

  // List-endpoint fallback: many invoices come back; the band must carry OUR
  //      invoice's IRN, never the first one in the list.
  await run(browser, 'list response — the right invoice is selected',
    Object.assign({ listResponse: true, exchangeRecord: true, requireConnection: true,
                    getRecordHangs: true, settleMs: 5000 }, fx),
    (s) => {
      ok('our IRN selected', s.details.includes('56261ce5227241efb114a6d60617be39'), s.details);
      ok('decoy IRN rejected', !s.details.includes('WRONG_IRN_DO_NOT_PRINT'));
    });

  await run(browser, 'org reaches Books via the header channel',
    Object.assign({ requireOrgHeader: true, requireConnection: true,
                    getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('details resolved via the org header',
         s.details.includes('112631363872267'), s.details);
      ok('a header-bearing shape won', /accepted shape: conn\+org-header/.test(s.diag),
         (s.diag.match(/accepted shape.*/) || [''])[0]);
    });

  await run(browser, 'live exchange-record wrapper — details resolve',
    Object.assign({ exchangeRecord: true, requireConnection: true,
                    getRecordHangs: true, settleMs: 4000 }, fx),
    (s) => {
      ok('details dug out of the exchange record',
         s.details.includes('112631363872267'), s.details);
    });

  // Live v32: a fresh GLOBALFIELDS.set succeeds yet the very next configured
  // call still carries the literal {vl__...}. One delayed retry must recover.
  await run(browser, 'literal placeholder on first call — retry recovers',
    Object.assign({ literalUntilRetry: true, getRecordHangs: true,
                    unknownGetHangs: true, settleMs: 6000 }, fx),
    (s) => {
      ok('retry recorded in diagnostics',
         /retrying once after 1800ms/.test(s.diag),
         (s.diag.match(/placeholder.*|no argument form.*/) || [''])[0]);
      ok('IRN rendered after the retry',
         s.details.includes('56261ce5227241efb114a6d60617be39'), s.details);
      ok('print enabled after the retry', s.printDisabled === false);
    });

  await run(browser, 'print produces a stamped PDF',
    Object.assign({ acceptShape: 'flat', exchangeRecord: true, getRecordHangs: true }, fx),
    async (s, errors, page) => {
      // Capture the blob instead of letting a tab open.
      await page.evaluate(() => {
        window.__opened = null;
        window.__blobBytes = null;
        const realCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function (blob) {
          const fr = new FileReader();
          fr.onload = function () { window.__blobBytes = fr.result; };
          fr.readAsDataURL(blob);
          return realCreate(blob);
        };
        window.open = function (u) { window.__opened = u; return { focus() {}, print() {} }; };
      });

      await page.click('#print-btn');
      await page.waitForFunction(() => window.__blobBytes !== null, { timeout: 20000 })
        .catch(() => {});

      const out = await page.evaluate(() => ({
        opened: window.__opened,
        bytes: window.__blobBytes,
        status: (document.getElementById('status') || {}).textContent || ''
      }));

      ok('a document was opened', !!out.opened, out.status);
      ok('a PDF was produced', !!out.bytes && /^data:application\/pdf/.test(out.bytes),
         (out.bytes || '').slice(0, 40));
      ok('status reports readiness', /ready|print or save/i.test(out.status), out.status);

      if (out.bytes) {
        const b64 = out.bytes.split(',')[1];
        const buf = Buffer.from(b64, 'base64');
        fs.writeFileSync(path.join(__dirname, 'e2e-stamped.pdf'), buf);
        const pdfjs = await import(path.join(SCRATCH, 'pdfjs-dist/legacy/build/pdf.mjs'));
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        let banded = 0, clientKept = 0;
        for (let i = 1; i <= doc.numPages; i++) {
          const t = (await (await doc.getPage(i)).getTextContent())
            .items.map(x => x.str).join('');
          if (t.includes('56261ce5227241efb114a6d60617be39')) banded++;
          if (/ADIVISHNU|Vannamei/.test(t)) clientKept++;
        }
        ok('band on every page', banded === doc.numPages, banded + '/' + doc.numPages);
        ok("client's own content preserved", clientKept === doc.numPages,
           clientKept + '/' + doc.numPages);
      }
    });

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
