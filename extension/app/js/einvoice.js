/*
 * Reads e-invoice details straight off the invoice, as Zoho Books already
 * recorded them when the invoice was pushed to the IRP. Nothing is entered by
 * hand and nothing is reconstructed.
 *
 * The shape Books returns (confirmed against a live e-invoiced organization):
 *
 *   "einvoice_details": {
 *     "inv_ref_num":      "53801fe38316ea9f...",      <- the IRN
 *     "ack_number":       "152625262386743",
 *     "ack_date":         "2026-04-02 11:18:00",
 *     "status":           "pushed",
 *     "status_formatted": "Pushed",
 *     "formatted_status": "Pushed",
 *     "is_cancellable":   false,
 *     "qr_link":          "https://books.zoho.in/einvoice/qrcode?eInvoiceID=..."
 *   }
 *
 * Two things are worth knowing about that payload:
 *
 *   - The IRN is under `inv_ref_num`, not `irn`. Books names it after the GST
 *     term "Invoice Reference Number".
 *   - There is no signed-QR *string*. Books exposes the QR as an image URL
 *     (`qr_link`) that it serves itself. So the QR is fetched, never generated —
 *     which is the correct outcome anyway, since the signed QR is an IRP
 *     signature that cannot legitimately be produced anywhere else.
 *
 * A few alternate key names are still accepted per field. That is not
 * speculation: Books runs per-data-centre and the invoice-list and
 * invoice-detail responses already differ slightly from each other, so a cheap
 * fallback costs nothing and avoids a silent blank field.
 */
var EInvoice = (function () {

  var ALIASES = {
    irn: ['inv_ref_num', 'irn', 'irn_number', 'irn_no'],
    ackNo: ['ack_number', 'ack_no', 'ackno'],
    ackDate: ['ack_date', 'ackdt', 'ackdate', 'irn_date'],
    status: ['status_formatted', 'formatted_status', 'status'],
    qrLink: ['qr_link', 'qrcode_link', 'qr_code_link', 'qr_url']
  };

  function pick(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return null;
  }

  function read(details) {
    return {
      irn: pick(details, ALIASES.irn),
      ackNo: pick(details, ALIASES.ackNo),
      ackDate: pick(details, ALIASES.ackDate),
      status: pick(details, ALIASES.status),
      qrLink: pick(details, ALIASES.qrLink)
    };
  }

  function isEmpty(d) {
    return !d.irn && !d.ackNo && !d.qrLink;
  }

  /*
   * Resolve the e-invoice details for one invoice.
   *
   * The invoice handed to a widget by ZFAPPS is normally the full record, but
   * the list-shaped payload carries a trimmed `einvoice_details` (no `qr_link`).
   * So if the QR link is missing, re-read the invoice through the API before
   * concluding there isn't one — the difference between "not e-invoiced" and
   * "context object was abridged" matters to what we tell the user.
   */
  function resolve(invoice) {
    var fromContext = read(invoice.einvoice_details);
    if (fromContext.qrLink) return Promise.resolve(fromContext);

    return ZFClient.booksGet('invoices/' + invoice.invoice_id)
      .then(function (body) {
        var full = body && (body.invoice || body);
        var fromApi = read(full && full.einvoice_details);
        // Prefer whichever view actually has content.
        return isEmpty(fromApi) ? fromContext : fromApi;
      })
      .catch(function (err) {
        /*
         * The lookup failed - which is NOT the same as the invoice having no
         * e-invoice, and must never be reported as such. Saying "no e-invoice
         * on record" when the request never succeeded sends whoever is looking
         * off hunting for a data problem that does not exist.
         */
        fromContext.lookupError = err && err.message
          ? err.message
          : 'Could not read the e-invoice record from Zoho Books.';
        return fromContext;
      });
  }

  return { resolve: resolve, _read: read, _isEmpty: isEmpty };
})();
