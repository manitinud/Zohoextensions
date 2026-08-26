/*
 * Invoice-detail widget controller.
 *
 * Reads the invoice in context, resolves its e-invoice details, previews what
 * will print, and opens the print document on demand.
 */
(function () {
  var state = { invoice: null, org: null, einvoice: null, settings: null, qr: null, qrError: null };

  function $(id) { return document.getElementById(id); }

  function setStatus(kind, text) {
    var el = $('status');
    el.className = 'status status--' + kind;
    el.textContent = text;
  }

  function row(label, value, mono) {
    if (!value) return '';
    return '<div class="kv"><span class="kv-k">' + label + '</span>'
      + '<span class="kv-v' + (mono ? ' mono' : '') + '">' + value + '</span></div>';
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderDetails() {
    var d = state.einvoice;
    var html = ''
      + row('IRN', d.irn ? escapeHtml(d.irn) : '<em class="muted">not found</em>', !!d.irn)
      + row('Ack No.', d.ackNo ? escapeHtml(d.ackNo) : '<em class="muted">not found</em>', !!d.ackNo)
      + row('Ack Date', d.ackDate ? escapeHtml(d.ackDate) : '<em class="muted">not found</em>')
      + row('Signed QR', state.qr
          ? '<span class="ok">present (' + QR.byteLength(d.signedQr) + ' bytes, '
            + state.qr.modules + '&times;' + state.qr.modules + ' modules)</span>'
          : '<span class="warn">' + escapeHtml(state.qrError || 'not found') + '</span>');
    $('details').innerHTML = html;

    if (state.qr) {
      $('qr-preview').innerHTML = '<img alt="e-Invoice QR preview" src="' + state.qr.dataUri + '">';
    } else {
      $('qr-preview').innerHTML = '';
    }
  }

  /*
   * The signed QR is the only field that cannot be reconstructed locally - it is
   * the IRP's signature over the invoice. If it is missing we still allow the
   * print (the IRN and Ack are useful on their own) but say so plainly, because
   * a QR-less e-invoice print is not a compliant one.
   */
  function buildQr() {
    state.qr = null;
    state.qrError = null;
    var payload = state.einvoice.signedQr;
    if (!payload) {
      state.qrError = 'No signed QR on record';
      return;
    }
    try {
      state.qr = QR.toDataUri(payload, state.settings.qrSizePx, state.settings.qrEcLevel);
    } catch (e) {
      state.qrError = e.message;
    }
  }

  function openPrint() {
    var html = PrintDoc.build({
      invoice: state.invoice,
      org: state.org,
      einvoice: state.einvoice,
      qrDataUri: state.qr ? state.qr.dataUri : null,
      qrError: state.qrError,
      settings: state.settings,
      docTitle: state.einvoice.irn ? 'Tax Invoice (e-Invoice)' : 'Tax Invoice'
    });

    var w = window.open('', '_blank');
    if (!w) {
      setStatus('warn', 'Your browser blocked the print window. Allow pop-ups for Zoho Books '
        + 'and try again.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Let layout settle so the repeating header measures correctly before print.
    w.onload = function () { setTimeout(function () { w.focus(); w.print(); }, 250); };
  }

  function fit() {
    ZFClient.resize(document.body.scrollHeight + 16);
  }

  function load() {
    setStatus('info', 'Loading invoice…');
    return Promise.all([
      ZFClient.getInvoice(),
      ZFClient.getOrganization(),
      EIStorage.load()
    ]).then(function (res) {
      state.invoice = res[0];
      state.org = res[1];
      state.settings = res[2];
      if (!state.invoice || !state.invoice.invoice_id) {
        throw new Error('No invoice in context.');
      }
      $('invoice-no').textContent = state.invoice.invoice_number || '';
      return EInvoice.resolve(state.invoice, state.settings);
    }).then(function (d) {
      state.einvoice = d;
      buildQr();
      renderDetails();

      if (!d.irn && !d.signedQr) {
        setStatus('warn', 'No e-invoice details found for this invoice. Check the source '
          + 'settings, or confirm the invoice was actually reported to the IRP.');
        $('print-btn').disabled = false;
      } else if (!state.qr) {
        setStatus('warn', 'IRN found, but no signed QR - the printed copy will not carry a '
          + 'scannable QR code.');
        $('print-btn').disabled = false;
      } else {
        setStatus('ok', 'e-Invoice details ready.');
        $('print-btn').disabled = false;
      }
      fit();
    }).catch(function (err) {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
