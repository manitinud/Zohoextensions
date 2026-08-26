/*
 * Per-organization settings for the e-Invoice Print extension.
 *
 * Sigma exposes org-scoped key/value storage through the ZFAPPS SDK. The exact
 * call signature is the one place this extension is coupled to the SDK's storage
 * API, so it is isolated here: if Sigma's storage call differs in your build,
 * change readRaw/writeRaw only.
 *
 * When the widget is opened outside Books (tests/local preview) it falls back to
 * localStorage so the print layout can still be exercised.
 */
var EIStorage = (function () {
  var KEY = 'einvoice_print_settings';

  var DEFAULTS = {
    // Where the IRN / Ack / signed QR come from.
    //   'books'  - Books' own e-invoicing (einvoice_details on the invoice)
    //   'custom' - IRN generated outside Books, parked in invoice custom fields
    //   'auto'   - use Books' values when present, else fall back to custom fields
    source: 'auto',

    // Custom field api_names used when source is 'custom' or as the 'auto' fallback.
    fields: {
      irn: 'cf_irn',
      ackNo: 'cf_ack_no',
      ackDate: 'cf_ack_date',
      signedQr: 'cf_signed_qr'
    },

    // Which rows appear in the repeating page header.
    header: {
      showQr: true,
      showIrn: true,
      showAck: true,
      showGstin: true,
      showPageNumbers: true
    },

    // Error-correction level for the QR. 'L' maximises capacity, which matters
    // because a signed QR is a JWS of ~800-1500 characters.
    qrEcLevel: 'L',
    qrSizePx: 150
  };

  function deepMerge(base, override) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      var b = base[k], o = override ? override[k] : undefined;
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        out[k] = deepMerge(b, o && typeof o === 'object' ? o : {});
      } else {
        out[k] = o === undefined || o === null ? b : o;
      }
    });
    return out;
  }

  function hasZFStorage() {
    return typeof ZFAPPS !== 'undefined' && ZFAPPS && typeof ZFAPPS.set === 'function';
  }

  function readRaw() {
    if (hasZFStorage()) {
      return ZFAPPS.get(KEY).then(function (res) {
        // ZFAPPS.get resolves { <key>: value }; an unset key resolves undefined.
        var val = res && (res[KEY] !== undefined ? res[KEY] : res);
        if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return null; } }
        return val || null;
      }).catch(function () { return null; });
    }
    try { return Promise.resolve(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return Promise.resolve(null); }
  }

  function writeRaw(value) {
    if (hasZFStorage()) {
      return ZFAPPS.set(KEY, JSON.stringify(value));
    }
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (e) { /* preview only */ }
    return Promise.resolve();
  }

  return {
    DEFAULTS: DEFAULTS,
    load: function () {
      return readRaw().then(function (stored) { return deepMerge(DEFAULTS, stored); });
    },
    save: function (settings) {
      return writeRaw(deepMerge(DEFAULTS, settings));
    }
  };
})();
