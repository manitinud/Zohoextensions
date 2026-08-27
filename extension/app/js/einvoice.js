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


  /*
   * Deep, wrapper-agnostic search of an API response.
   *
   * Three response generations have now been seen or implied (v1 wrapper, 2.0
   * direct, and unknown nesting), and every unwrapping assumption so far has
   * been wrong at least once. So: stop assuming. Walk everything, parse any
   * string that looks like JSON, and take einvoice_details / its fields from
   * wherever they actually live.
   */
  function deepExtract(root, targetId) {
    var found = { details: null, fields: {}, matched: false };
    var WANT = { inv_ref_num: 'irn', irn: 'irn', ack_number: 'ackNo',
                 ack_date: 'ackDate', qr_link: 'qrLink',
                 qr_code: 'qrData', signed_qr_code: 'qrData',
                 qr_code_image: 'qrData', einvoice_qr_code: 'qrData',
                 status_formatted: 'status' };

    function walk(node, depth) {
      if (depth > 6 || node === null || node === undefined) return;
      if (typeof node === 'string') {
        if (node.length > 20 && node.length < 300000 && /^[\s]*[{\[]/.test(node)) {
          try { walk(JSON.parse(node), depth + 1); } catch (e) { /* not JSON */ }
        }
        return;
      }
      if (typeof node !== 'object') return;
      if (Object.prototype.toString.call(node) === '[object Array]') {
        for (var i = 0; i < node.length && i < 50; i++) walk(node[i], depth + 1);
        return;
      }
      /*
       * If this object IS an invoice (has invoice_id), only take its
       * einvoice_details when it is THE invoice — a list response carries
       * many invoices, and the first one's IRN is not necessarily ours.
       * An exact match always wins over any earlier loose find.
       */
      var isTarget = targetId && String(node.invoice_id) === String(targetId);
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (k === 'einvoice_details' && v && typeof v === 'object') {
          if (isTarget) { found.details = v; found.matched = true; }
          else if (!found.details && (!targetId || node.invoice_id === undefined)) {
            found.details = v;
          }
        }
        var mapped = WANT[k.toLowerCase()];
        if (mapped && v !== null && v !== undefined && v !== ''
            && typeof v !== 'object' && found.fields[mapped] === undefined) {
          found.fields[mapped] = String(v);
        }
        walk(v, depth + 1);
      });
    }
    walk(root, 0);
    return found;
  }

  /* Compact outline of a response for the diagnostics panel — verbatim, so no
   * wrapper shape can go undescribed again. */
  function outline(body) {
    try {
      if (body === null || body === undefined) return String(body);
      if (typeof body === 'string') {
        return 'string[' + body.length + ']: ' + body.slice(0, 300);
      }
      return JSON.stringify(body).slice(0, 1200);
    } catch (e) { return 'unserialisable: ' + (e.message || e); }
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
    var scanned = fromScan(invoice);

    var merged = {
      irn: fromContext.irn || scanned.details.irn,
      ackNo: fromContext.ackNo || scanned.details.ackNo,
      ackDate: fromContext.ackDate || scanned.details.ackDate,
      status: fromContext.status || scanned.details.status,
      qrLink: fromContext.qrLink || scanned.details.qrLink,
      qrData: null,
      scanHits: scanned.hits,
      trace: []
    };
    // Data already on the page still goes through withQr: the printable QR
    // comes from the e-invoice record's signed_qr_code, never from qr_link.
    if (merged.irn || merged.qrLink) return withQr(merged);

    /*
     * The Books page itself displays the e-invoice state, so ask the page
     * before calling any API: ZFAPPS.get takes dotted paths (the official
     * sample sets 'invoice.reference_number'), making this free if it works.
     */
    /*
     * Dotted-path gets, all CONCURRENT and all TIME-CAPPED. This SDK's
     * signature failure is hanging, and an unknown path may hang too — an
     * uncapped probe here would freeze the panel before the API is even tried.
     */
    function tryPathGet() {
      var paths = ['invoice.einvoice_details'];
      return Promise.all(paths.map(function (path) {
        var call;
        try { call = ZFAPPS.get(path); } catch (e) { call = Promise.reject(e); }
        if (!call || typeof call.then !== 'function') call = Promise.reject(new Error('no promise'));
        return ZFClient.timeout(call, path).then(function (r) {
          var v = r && (r[path] !== undefined ? r[path] : r);
          var d = read(v);
          merged.trace.push('get(' + path + '): '
            + (v && typeof v === 'object'
               ? outline(v).slice(0, 200) : String(v)));
          return isEmpty(d) ? null : d;
        }).catch(function (e) {
          merged.trace.push('get(' + path + '): ' + (e && e.message || e));
          return null;
        });
      })).then(function (results) {
        return results.filter(Boolean)[0] || null;
      });
    }

    /*
     * The page probe and the API read RACE: both are reads, so whichever
     * yields data first is the answer, and neither can delay the other.
     */
    var pageP = tryPathGet().catch(function () { return null; });
    var apiP = ZFClient.getInvoiceRecord(invoice.invoice_id, invoice.invoice_number)
      .then(function (body) {
        merged.trace.push('api body: ' + outline(body));
        var dug = deepExtract(body, invoice.invoice_id);
        var d = dug.details ? read(dug.details) : {
          irn: dug.fields.irn || null,
          ackNo: dug.fields.ackNo || null,
          ackDate: dug.fields.ackDate || null,
          status: dug.fields.status || null,
          qrLink: dug.fields.qrLink || null
        };
        d.qrData = d.qrData || dug.fields.qrData || null;
        return isEmpty(d) ? null : d;
      })
      .catch(function (err) {
        merged.lookupError = err && err.message
          ? err.message
          : 'Could not read the e-invoice record from Zoho Books.';
        return null;
      });

    function withQr(d) {
      // qr_link is NOT enough: it points at books.zoho.in, which an API
      // Configuration cannot reach. The e-invoice record's signed_qr_code
      // is the printable source, so fetch it whenever qrData is missing.
      if (!d || d.qrData || !d.irn) return Promise.resolve(d);
      if (typeof ZFClient.getEinvoiceInfo !== 'function') return Promise.resolve(d);
      return ZFClient.getEinvoiceInfo(invoice.invoice_id).then(function (body) {
        merged.trace.push('einvoice body: ' + outline(body));
        var dug = deepExtract(body, invoice.invoice_id);
        var extra = dug.details ? read(dug.details) : dug.fields;
        d.qrLink = d.qrLink || extra.qrLink || dug.fields.qrLink || null;
        d.qrData = d.qrData || dug.fields.qrData || null;
        return d;
      }).catch(function (e) {
        merged.trace.push('einvoice info: ' + (e && e.message || e));
        return d;
      });
    }

    return new Promise(function (resolveOut) {
      var remaining = 2, winner = null;
      function on(d) {
        if (winner) return;
        if (d) {
          winner = d;
          d.scanHits = merged.scanHits;
          d.trace = merged.trace;
          withQr(d).then(resolveOut);
          return;
        }
        if (--remaining === 0) resolveOut(merged);
      }
      pageP.then(on);
      apiP.then(on);
    });
  }

  return { resolve: resolve, _read: read, _isEmpty: isEmpty, _scan: fromScan,
           _deepExtract: deepExtract, _outline: outline };
})();
