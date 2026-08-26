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


  /*
   * Scan the invoice for e-invoice data under ANY key name, at any depth.
   *
   * The widget receives a 117-field invoice, and einvoice_details is not one of
   * those fields — but the data may well be present under a different name.
   * Finding it locally removes the API call entirely, which is the difference
   * between an instant panel and one that waits on the network.
   *
   * Returns { paths: [[path, value]], found: {...} } for reporting and use.
   */
  var SCAN = /irn|einv|e_inv|ack_?(no|num|date)|qr_?(link|code|url)|ref_?num/i;

  function scan(obj, path, out, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4) return out;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      var here = path ? path + '.' + k : k;
      if (SCAN.test(k) && v !== null && v !== undefined && v !== ''
          && typeof v !== 'object') {
        out.push([here, String(v)]);
      }
      if (v && typeof v === 'object') scan(v, here, out, depth + 1);
    });
    return out;
  }

  /*
   * Map whatever the scan turned up onto the four fields we print. Keys are
   * matched by suffix so both einvoice_details.inv_ref_num and a top-level
   * inv_ref_num resolve the same way.
   */
  function fromScan(invoice) {
    var hits = scan(invoice, '', [], 0);
    var byLeaf = {};
    hits.forEach(function (h) {
      var leaf = h[0].split('.').pop().toLowerCase();
      if (byLeaf[leaf] === undefined) byLeaf[leaf] = h[1];
    });

    function first(names) {
      for (var i = 0; i < names.length; i++) {
        if (byLeaf[names[i]] !== undefined) return byLeaf[names[i]];
      }
      return null;
    }

    return {
      hits: hits,
      details: {
        irn: first(['inv_ref_num', 'irn', 'irn_number', 'irn_no']),
        ackNo: first(['ack_number', 'ack_no', 'ackno']),
        ackDate: first(['ack_date', 'ackdt', 'ackdate']),
        status: first(['einvoice_status', 'einvoice_status_formatted']),
        qrLink: first(['qr_link', 'qrcode_link', 'qr_code_link', 'qr_url'])
      }
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

    // Always scan, even when the context already has what we need: it costs
    // nothing against an in-memory object and it is the single most useful
    // thing the panel can report about an invoice that does not resolve.
    var scanned = fromScan(invoice);

    if (fromContext.qrLink) {
      fromContext.scanHits = scanned.hits;
      return Promise.resolve(fromContext);
    }

    var merged = {
      irn: fromContext.irn || scanned.details.irn,
      ackNo: fromContext.ackNo || scanned.details.ackNo,
      ackDate: fromContext.ackDate || scanned.details.ackDate,
      status: fromContext.status || scanned.details.status,
      qrLink: fromContext.qrLink || scanned.details.qrLink,
      scanHits: scanned.hits
    };

    if (merged.irn || merged.qrLink) return Promise.resolve(merged);

    return ZFClient.getInvoiceRecord(invoice.invoice_id)
      .then(function (body) {
        var full = body && (body.invoice || body);

        // Summarise the response for the diagnostics panel: what came back is
        // the difference between 'no e-invoice' and 'wrong call'.
        var summary = {};
        if (body && typeof body === 'object') {
          summary.bodyKeys = Object.keys(body).slice(0, 12).join(',');
          if (body.code !== undefined) summary.code = body.code;
          if (body.message) summary.message = String(body.message).slice(0, 90);
          summary.hasInvoice = !!body.invoice;
          if (full && typeof full === 'object') {
            summary.invoiceKeys = Object.keys(full).length;
            summary.hasEinvoiceDetails = !!full.einvoice_details;
          }
        } else {
          summary.bodyKeys = typeof body;
        }

        var fromApi = read(full && full.einvoice_details);
        if (!isEmpty(fromApi)) {
          fromApi.scanHits = merged.scanHits;
          fromApi.apiResponse = summary;
          return fromApi;
        }
        var apiScan = fromScan(full || {});
        var winner = isEmpty(apiScan.details) ? merged : apiScan.details;
        winner.scanHits = (merged.scanHits || []).concat(apiScan.hits);
        winner.apiResponse = summary;
        return winner;
      })
      .catch(function (err) {
        merged.lookupError = err && err.message
          ? err.message
          : 'Could not read the e-invoice record from Zoho Books.';
        return merged;
      });
  }

  return { resolve: resolve, _read: read, _isEmpty: isEmpty, _scan: fromScan };
})();
