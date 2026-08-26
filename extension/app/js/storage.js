/*
 * Per-organization settings.
 *
 * There is deliberately nothing here about *where* e-invoice data comes from:
 * it always comes from Zoho Books' own e-invoice record on the invoice, with no
 * setup. These settings only affect how the printed page looks.
 *
 * Sigma exposes org-scoped key/value storage through the ZFAPPS SDK. That call
 * is the one place this extension is coupled to the SDK's storage API, so it is
 * isolated in readRaw/writeRaw. Outside Books (local preview, tests) it falls
 * back to localStorage so the layout can still be exercised.
 */
var EIStorage = (function () {
  var KEY = 'einvoice_print_settings';

  var DEFAULTS = {
    // Which rows appear in the band that repeats at the top of every page.
    header: {
      showQr: true,
      showIrn: true,
      showAck: true,
      showGstin: true,
      showStatus: false,
      showPageNumbers: true
    },
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
        var val = res && (res[KEY] !== undefined ? res[KEY] : res);
        if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return null; } }
        return val || null;
      }).catch(function () { return null; });
    }
    try { return Promise.resolve(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return Promise.resolve(null); }
  }

  function writeRaw(value) {
    if (hasZFStorage()) return ZFAPPS.set(KEY, JSON.stringify(value));
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
