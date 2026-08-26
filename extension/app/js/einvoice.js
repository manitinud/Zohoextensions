/*
 * Resolves the four things an e-invoice print needs — IRN, Ack No, Ack Date and
 * the signed QR string — out of whatever Zoho Books hands back.
 *
 * Three shapes have to be handled, because they carry different key styles:
 *
 *   1. invoice.einvoice_details        - Books' own snake_case summary
 *   2. GET /invoices/{id}/einvoice     - closer to the IRP payload, PascalCase
 *                                        GST names (Irn, AckNo, AckDt, SignedQRCode)
 *   3. invoice custom fields           - for IRNs generated outside Books, where
 *                                        the org parked the values themselves
 *
 * Rather than hard-coding one key per source, each field declares the aliases it
 * answers to and we walk the object graph looking for them. That keeps the
 * extension working if Books renames a key or nests the payload one level deeper.
 */
var EInvoice = (function () {

  var ALIASES = {
    irn: ['irn', 'irnnumber', 'irn_no', 'irnno'],
    ackNo: ['ackno', 'ack_number', 'ack_no', 'acknowledgementnumber', 'acknumber'],
    ackDate: ['ackdt', 'ack_date', 'ackdate', 'acknowledgementdate', 'irndt', 'irn_date'],
    signedQr: ['signedqrcode', 'signed_qr_code', 'signed_qrcode', 'qrcodestring',
               'qr_code_string', 'signedqr', 'signed_qr'],
    status: ['einvoice_status', 'status', 'irnstatus']
  };

  function norm(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /*
   * Depth-limited search for the first non-empty value whose key matches one of
   * `aliases`. Depth is capped so a large invoice payload can't cost much, and
   * arrays are walked because the IRP wraps responses in single-element lists.
   */
  function find(obj, aliases, depth) {
    if (obj === null || typeof obj !== 'object' || (depth || 0) > 5) return null;
    var wanted = aliases.map(norm);

    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var fromArr = find(obj[i], aliases, (depth || 0) + 1);
        if (fromArr) return fromArr;
      }
      return null;
    }

    var keys = Object.keys(obj);
    // Direct hits first, so a nested stale copy never shadows the top-level value.
    for (var j = 0; j < keys.length; j++) {
      if (wanted.indexOf(norm(keys[j])) === -1) continue;
      var v = obj[keys[j]];
      if (v !== null && v !== undefined && v !== '' && typeof v !== 'object') return String(v);
    }
    for (var k = 0; k < keys.length; k++) {
      var child = obj[keys[k]];
      if (child && typeof child === 'object') {
        var nested = find(child, aliases, (depth || 0) + 1);
        if (nested) return nested;
      }
    }
    return null;
  }

  function fromCustomFields(invoice, fieldMap) {
    var byApiName = {};
    (invoice.custom_fields || []).forEach(function (f) {
      if (f && f.api_name) byApiName[f.api_name] = f.value_formatted || f.value;
    });
    // custom_field_hash keys are api_names too, and are present even when the
    // field list is trimmed from the response.
    Object.assign(byApiName, invoice.custom_field_hash || {});

    function pick(name) {
      var v = name ? byApiName[name] : null;
      return v === undefined || v === null || v === '' ? null : String(v);
    }
    return {
      irn: pick(fieldMap.irn),
      ackNo: pick(fieldMap.ackNo),
      ackDate: pick(fieldMap.ackDate),
      signedQr: pick(fieldMap.signedQr)
    };
  }

  function merge(primary, fallback) {
    var out = {};
    ['irn', 'ackNo', 'ackDate', 'signedQr', 'status'].forEach(function (k) {
      out[k] = (primary && primary[k]) || (fallback && fallback[k]) || null;
    });
    return out;
  }

  /*
   * Pulls e-invoice details for one invoice.
   *
   * `invoice` is the invoice already in widget context. The dedicated e-invoice
   * endpoint is only called when it can add something the invoice object lacks,
   * because on a non-e-invoiced document it returns an error rather than an
   * empty body — an expected outcome, not a failure, so it is swallowed.
   */
  function resolve(invoice, settings) {
    var fromInvoice = {
      irn: find(invoice.einvoice_details || invoice, ALIASES.irn),
      ackNo: find(invoice.einvoice_details || invoice, ALIASES.ackNo),
      ackDate: find(invoice.einvoice_details || invoice, ALIASES.ackDate),
      signedQr: find(invoice.einvoice_details || invoice, ALIASES.signedQr),
      status: find(invoice.einvoice_details || {}, ALIASES.status)
    };
    var custom = fromCustomFields(invoice, settings.fields);

    if (settings.source === 'custom') return Promise.resolve(merge(custom, null));

    // The signed QR is the one field that cannot be reconstructed locally, so it
    // alone justifies the extra API round trip.
    var needsEndpoint = !fromInvoice.signedQr &&
      (settings.source === 'books' || !custom.signedQr);

    if (!needsEndpoint) {
      return Promise.resolve(settings.source === 'books'
        ? merge(fromInvoice, null)
        : merge(fromInvoice, custom));
    }

    return ZFClient.booksGet('invoices/' + invoice.invoice_id + '/einvoice')
      .then(function (body) {
        var fromApi = {
          irn: find(body, ALIASES.irn),
          ackNo: find(body, ALIASES.ackNo),
          ackDate: find(body, ALIASES.ackDate),
          signedQr: find(body, ALIASES.signedQr),
          status: find(body, ALIASES.status)
        };
        var books = merge(fromInvoice, fromApi);
        return settings.source === 'books' ? books : merge(books, custom);
      })
      .catch(function () {
        // Not e-invoiced through Books, or the endpoint is unavailable for this
        // org. Fall back to whatever the invoice and custom fields already gave.
        return settings.source === 'books' ? merge(fromInvoice, null) : merge(fromInvoice, custom);
      });
  }

  return { resolve: resolve, _find: find };
})();
