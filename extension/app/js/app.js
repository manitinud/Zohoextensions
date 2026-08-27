/*
 * Invoice-detail widget controller.
 *
 * Flow, with no configuration anywhere in it: take the invoice in context, read
 * the e-invoice record Zoho Books already holds for it, fetch the QR image Books
 * issued, build the print document.
 */
(function () {

  var BUILD = 'v29';

  /*
   * Print appearance. There is no settings widget: Zoho Books extensions expose
   * no placement for one, and ZFAPPS.set writes invoice fields rather than
   * extension storage, so there is nowhere to persist per-org preferences.
   * These are the single place to change how the printed band looks.
   */
  var SETTINGS = {
    header: {
      showQr: true,
      showIrn: true,
      showAck: true,
      showGstin: true,
      showStatus: true,
      showPageNumbers: true
    },
    qrSizePx: 150
  };

  var state = {
    invoice: null, org: null, einvoice: null,
    qr: null   // { dataUri, remoteUrl, inlined, error }
  };

  /*
   * What the SDK actually handed over. Kept so the panel can show it: when a
   * request fails inside a customer's org there is no console to inspect and no
   * way to reproduce it here, so the widget has to be able to report on itself.
   */
  var diag = { lines: [] };
  function note(label, value) {
    diag.lines.push([label, value]);
    // Rendering or resizing must never break the caller: note() is the
    // reporting path, and an exception here silently truncated the whole
    // report at whichever line happened to be first.
    try { renderDiagnostics(); } catch (e) { /* keep collecting */ }
    try { fit(); } catch (e) { /* resize is cosmetic */ }
  }

  /*
   * Report what the SDK actually exposes.
   *
   * The extension cannot be run outside a Zoho Books organization, and the
   * Zoho developer docs are not reachable from where this was written, so the
   * available ZFAPPS surface has to be discovered from inside a real org. This
   * runs before anything that could fail, so the report always renders.
   */
  function probeSdk() {
    note('build', BUILD);
    note('SDK script', window.__sdkUrl || 'unknown');

    if (typeof ZFAPPS === 'undefined' || !ZFAPPS) {
      note('ZFAPPS', 'NOT PRESENT');
      return;
    }
    var keys = [];
    for (var k in ZFAPPS) { keys.push(k); }
    note('ZFAPPS keys', keys.sort().join(', ') || '(none enumerable)');
    ['request', 'get', 'set', 'invoke', 'retrieve', 'store', 'API', 'linkFiles']
      .forEach(function (m) {
        // Reading a property can throw if the SDK exposes it as a getter that
        // is not ready yet; one bad read must not silence the rest of the report.
        try { note('ZFAPPS.' + m, typeof ZFAPPS[m]); }
        catch (e) { note('ZFAPPS.' + m, 'threw: ' + (e.message || e)); }
      });

    // ZFAPPS.API is an object rather than a function; whatever it exposes may be
    // the intended route for configured API calls.
    try {
      if (ZFAPPS.API && typeof ZFAPPS.API === 'object') {
        var ak = [];
        for (var a in ZFAPPS.API) { ak.push(a + '(' + (typeof ZFAPPS.API[a])[0] + ')'); }
        note('ZFAPPS.API members', ak.sort().join(', ') || '(none enumerable)');

        /*
         * GLOBALFIELDS appeared in the SDK 2.0 surface. Global fields are how
         * API-configuration {placeholders} get per-organization values, so what
         * this object exposes — and whether fields are readable or writable at
         * runtime — decides how far the multi-org design can go.
         */
        var gf = ZFAPPS.API.GLOBALFIELDS;
        if (gf && typeof gf === 'object') {
          var gk = [];
          for (var g in gf) { gk.push(g + '(' + (typeof gf[g])[0] + ')'); }
          note('GLOBALFIELDS members', gk.sort().join(', ') || '(none enumerable)');
          ['get', 'getAll', 'update', 'set'].forEach(function (fn) {
            if (typeof gf[fn] === 'function') {
              try {
                var call = fn === 'get' ? gf[fn]({ name: 'organization_id' }) : gf[fn]();
                if (call && typeof call.then === 'function') {
                  ZFClient.timeout(call, 'GLOBALFIELDS.' + fn).then(function (r) {
                    note('GLOBALFIELDS.' + fn + '()',
                         (JSON.stringify(r) || String(r)).slice(0, 200));
                  }, function (e) {
                    note('GLOBALFIELDS.' + fn + '()', 'rejected: '
                         + ((e && e.message) || e));
                  });
                } else {
                  note('GLOBALFIELDS.' + fn + '()', String(call).slice(0, 120));
                }
              } catch (e2) {
                note('GLOBALFIELDS.' + fn + '()', 'threw: ' + (e2.message || e2));
              }
            }
          });
        }
      }
    } catch (e) { note('ZFAPPS.API members', 'threw: ' + (e.message || e)); }
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(kind, text) {
    var el = $('status');
    el.className = 'status status--' + kind;
    el.textContent = text;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function row(label, valueHtml, mono) {
    return '<div class="kv"><span class="kv-k">' + label + '</span>'
      + '<span class="kv-v' + (mono ? ' mono' : '') + '">' + valueHtml + '</span></div>';
  }

  function missing() { return '<em class="muted">not recorded</em>'; }

  function renderDetails() {
    var d = state.einvoice;
    var qrCell;
    if (state.qr && state.qr.dataUri) {
      qrCell = '<span class="ok">embedded in print</span>';
    } else if (state.qr && state.qr.remoteUrl) {
      qrCell = '<span class="warn">linked from Zoho Books</span>';
    } else {
      qrCell = missing();
    }

    $('details').innerHTML =
        row('IRN', d.irn ? esc(d.irn) : missing(), !!d.irn)
      + row('Ack No.', d.ackNo ? esc(d.ackNo) : missing(), !!d.ackNo)
      + row('Ack Date', d.ackDate ? esc(d.ackDate) : missing())
      + row('Status', d.status ? esc(d.status) : missing())
      + row('QR', qrCell);

    var src = state.qr && (state.qr.dataUri || state.qr.remoteUrl);
    $('qr-preview').innerHTML = src
      ? '<img alt="e-Invoice QR preview" src="' + src + '">'
      : '';
  }

  /*
   * Produce the printable copy.
   *
   * The organization's own Zoho Books invoice PDF is fetched and the e-invoice
   * band is stamped onto every page of it. The extension deliberately does not
   * render its own invoice layout: every organization customises its Books
   * template, and that template is the document their customers expect.
   */
  function openPrint() {
    if (!state.einvoice || (!state.einvoice.irn && !state.einvoice.ackNo)) {
      setStatus('warn', 'Nothing to stamp - this invoice has no e-invoice details.');
      return;
    }

    setStatus('info', 'Fetching the invoice PDF from Zoho Books\u2026');
    $('print-btn').disabled = true;

    ZFClient.getInvoicePdf(state.invoice.invoice_id)
      .then(function (pdfB64) {
        setStatus('info', 'Adding the e-invoice band to every page\u2026');
        return PDFStamp.stamp({
          pdfBytes: PDFStamp._base64ToBytes(pdfB64),
          einvoice: state.einvoice,
          qrPngBase64: state.qr && state.qr.dataUri ? state.qr.dataUri : null,
          showStatus: SETTINGS.header.showStatus
        });
      })
      .then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        var url = URL.createObjectURL(blob);
        var w = window.open(url, '_blank');
        if (!w) {
          setStatus('warn', 'Your browser blocked the new window. Allow pop-ups for Zoho Books, '
            + 'then try again.');
        } else {
          setStatus('ok', 'e-Invoice copy ready. Print or save it from the new tab.');
        }
        // Give the tab time to take the blob before releasing it.
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        $('print-btn').disabled = false;
      })
      .catch(function (err) {
        setStatus('error', 'Could not build the e-invoice copy: ' + (err.message || err));
        $('print-btn').disabled = false;
      });
  }

  function diagText() {
    return diag.lines.map(function (l) { return l[0] + ': ' + l[1]; }).join('\n');
  }

  function renderDiagnostics() {
    var el = $('diag');
    if (!el || !diag.lines.length) return;
    el.innerHTML =
        '<details open><summary>Diagnostics</summary>'
      + '<textarea id="diag-text" class="diag-text" readonly rows="14"></textarea>'
      + '<button type="button" class="btn diag-copy" id="diag-copy">Copy diagnostics</button>'
      + '</details>';
    $('diag-text').value = diagText();
    $('diag-copy').addEventListener('click', function () {
      var t = $('diag-text');
      t.select();
      try { document.execCommand('copy'); this.textContent = 'Copied'; }
      catch (e) { this.textContent = 'Select the text above and copy'; }
    });
  }

  function fit() { ZFClient.resize(document.body.scrollHeight + 16); }

  function report() {
    var d = state.einvoice;

    /*
     * A failed lookup is reported as a failure, never as "no e-invoice". The
     * two look identical in the data and mean completely different things.
     */
    if (d.lookupError && !d.irn && !d.ackNo) {
      setStatus('error', 'Could not read this invoice\'s e-invoice details from Zoho Books: '
        + d.lookupError);
      return;
    }

    /*
     * Not an error, and styled as information rather than a warning: most
     * invoices in most organizations were never e-invoiced, so this is the
     * ordinary state for anyone opening the panel on an arbitrary invoice.
     */
    if (!d.irn && !d.ackNo && !d.qrLink) {
      setStatus('info', 'This invoice has no e-invoice on record. Open an invoice that has been '
        + 'pushed to the IRP and its IRN, Ack details and QR code will appear here, ready to '
        + 'print.');
      return;
    }
    if (!state.qr || (!state.qr.dataUri && !state.qr.remoteUrl)) {
      setStatus('warn', 'IRN found, but Books returned no QR for this e-invoice. The printed '
        + 'copy will carry the IRN and Ack details without a QR code.');
      return;
    }
    if (!state.qr.dataUri) {
      setStatus('warn', 'Ready. The QR is linked from Zoho Books rather than embedded, so a '
        + 'saved PDF will only show it while you are signed in to Books.');
      return;
    }
    setStatus('ok', 'e-Invoice details loaded from Zoho Books. Ready to print.');
  }

  function load() {
    setStatus('info', 'Reading e-invoice details from Zoho Books\u2026');
    $('print-btn').disabled = true;

    return Promise.all([ZFClient.getInvoice(), ZFClient.getOrganization()])
      .then(function (res) {
        state.invoice = res[0];
        state.org = res[1];
        if (!state.invoice || !state.invoice.invoice_id) throw new Error('No invoice in context.');
        $('invoice-no').textContent = state.invoice.invoice_number || '';

        var ikeys = Object.keys(state.invoice);
        note('invoice keys returned', ikeys.length);
        note('einvoice_details present', state.invoice.einvoice_details ? 'YES' : 'NO');
        if (state.invoice.einvoice_details) {
          note('einvoice_details keys',
               Object.keys(state.invoice.einvoice_details).join(', '));
        } else {
          // Which keys DID come back tells us whether this is the full record
          // or an abridged one, and that decides whether an API call is needed.
          note('keys sample', ikeys.slice(0, 30).join(', '));
        }
        note('API config (details)', ZFClient.API.invoice);
        note('API config (pdf)', ZFClient.API.invoicePdf);
        note('API config (qr)', ZFClient.API.einvoiceQr);

        return EInvoice.resolve(state.invoice);
      })
      .then(function (d) {
        state.einvoice = d;
        // QR data delivered inline (base64/signed) needs no fetch at all.
        if (d.qrData) {
          var uri = QRImage._toDataUri(d.qrData);
          if (uri) {
            state.qr = { dataUri: uri, remoteUrl: d.qrLink || null, inlined: true, error: null };
          }
        }
        // What the invoice itself contained matters most: a hit here means no
        // network call is needed at all.
        (d.trace || []).forEach(function (t) { note('trace', t); });
        if (d.apiResponse) {
          var r = d.apiResponse;
          note('API response keys', r.bodyKeys || '?');
          if (r.code !== undefined) note('API response code', r.code);
          if (r.message) note('API response message', r.message);
          note('API response has invoice', r.hasInvoice ? 'yes ('
               + (r.invoiceKeys || '?') + ' keys)' : 'NO');
          note('API invoice has einvoice_details',
               r.hasEinvoiceDetails ? 'YES' : 'no');
        }
        var hits = d.scanHits || [];
        note('einvoice-ish keys in invoice', hits.length);
        hits.slice(0, 12).forEach(function (h) {
          note('  ' + h[0], String(h[1]).slice(0, 70));
        });
        return state.qr ? Promise.resolve(state.qr) : QRImage.fetchQr(d.qrLink);
      })
      .then(function (qr) {
        state.qr = qr;
        if (state.einvoice.lookupError) note('API error', state.einvoice.lookupError);
        var log = ZFClient._shapeLog();
        if (log.length) note('request shapes tried', log.join(' | '));
        if (ZFClient._callShape()) note('accepted shape', ZFClient._callShape());
        if (qr && qr.error) note('QR fetch', qr.error);
        renderDiagnostics();
        renderDetails();
        report();
        $('print-btn').disabled = false;
        fit();
      })
      .catch(function (err) {
        setStatus('error', err.message || String(err));
        fit();
      });
  }

  function boot() {
    $('print-btn').addEventListener('click', openPrint);
    $('reload-btn').addEventListener('click', load);

    try { probeSdk(); } catch (e) { note('probe failed', e && e.message || String(e)); }
    try { renderDiagnostics(); } catch (e) { /* reported on the next note */ }

    if (!ZFClient.available()) {
      setStatus('error', 'This widget must run inside Zoho Books.');
      return;
    }
    var INIT_TIMEOUT_MS =
      (typeof location !== 'undefined' && /[?&]fastTimeouts=1/.test(location.search))
        ? 600 : 10000;
    var initDone = false;

    function proceed(how) {
      if (initDone) return;
      initDone = true;
      note('extension.init', how);
      load();
    }

    setTimeout(function () {
      // Not fatal: init hanging has not stopped ZFAPPS.get from working, and a
      // panel that reports what it found is worth more than one that spins.
      proceed('timed out after ' + (INIT_TIMEOUT_MS / 1000) + 's - continuing anyway');
    }, INIT_TIMEOUT_MS);

    try {
      var p = ZFClient.init();
      if (p && typeof p.then === 'function') {
        p.then(function () { proceed('ok'); },
               function (err) { proceed('rejected: ' + (err && err.message || err)); });
      } else {
        proceed('did not return a promise');
      }
    } catch (e) {
      proceed('threw: ' + (e && e.message || e));
    }
  }

  function whenReady() {
    // The SDK now loads asynchronously; __sdkReady always resolves (success,
    // fallback, or nothing loaded), so this cannot hang the widget.
    (window.__sdkReady || Promise.resolve()).then(boot);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
})();
