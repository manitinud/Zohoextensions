/*
 * Invoice-detail widget controller.
 *
 * Flow, with no configuration anywhere in it: take the invoice in context, read
 * the e-invoice record Zoho Books already holds for it, fetch the QR image Books
 * issued, build the print document.
 */
(function () {

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

    ZFClient.booksGetBinary('invoices/' + state.invoice.invoice_id, { accept: 'pdf' })
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
    setStatus('info', 'Reading e-invoice details from Zoho Books…');
    $('print-btn').disabled = true;

    return Promise.all([ZFClient.getInvoice(), ZFClient.getOrganization()])
      .then(function (res) {
        state.invoice = res[0];
        state.org = res[1];
        if (!state.invoice || !state.invoice.invoice_id) throw new Error('No invoice in context.');
        $('invoice-no').textContent = state.invoice.invoice_number || '';
        return EInvoice.resolve(state.invoice);
      })
      .then(function (d) {
        state.einvoice = d;
        return QRImage.fetchQr(d.qrLink);
      })
      .then(function (qr) {
        state.qr = qr;
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

    if (!ZFClient.available()) {
      setStatus('error', 'This widget must run inside Zoho Books.');
      return;
    }
    ZFClient.init().then(load).catch(function (err) {
      setStatus('error', err.message || String(err));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
