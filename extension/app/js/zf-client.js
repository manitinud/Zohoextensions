/*
 * Thin wrapper over the Zoho Finance extensions SDK (ZFAPPS).
 *
 * Everything the widget needs from the host app goes through here: the invoice
 * in context, the organization, and proxied Zoho Books API calls. Requests are
 * proxied by ZFAPPS using the signed-in user's own Books session, so the
 * extension needs no separate OAuth connection to read the org's own data.
 */
var ZFClient = (function () {
  var org = null;

  function available() {
    return typeof ZFAPPS !== 'undefined' && ZFAPPS && ZFAPPS.extension;
  }

  function init() {
    if (!available()) {
      return Promise.reject(new Error(
        'ZFAPPS SDK not available. This page must run as a Zoho Books extension widget.'
      ));
    }
    return ZFAPPS.extension.init();
  }

  // ZFAPPS.get resolves { <entity>: {...} }; unwrap so callers get the entity.
  function unwrap(res, key) {
    if (!res) return null;
    return res[key] !== undefined ? res[key] : res;
  }

  function getInvoice() {
    return ZFAPPS.get('invoice').then(function (r) { return unwrap(r, 'invoice'); });
  }

  function getOrganization() {
    if (org) return Promise.resolve(org);
    return ZFAPPS.get('organization').then(function (r) {
      org = unwrap(r, 'organization');
      return org;
    });
  }

  /*
   * GET against the Books API through the ZFAPPS proxy.
   *
   * `path` is relative to the Books API root, e.g. 'invoices/12345/einvoice'.
   * Resolves the parsed response body, or rejects with an Error carrying the
   * Books error code so callers can distinguish "not e-invoiced" (a normal
   * state) from a real failure.
   */
  function booksGet(path, params) {
    return getOrganization().then(function (o) {
      var query = Object.assign({ organization_id: o && (o.organization_id || o.id) }, params || {});
      return ZFAPPS.request({
        url: 'https://www.zohoapis.com/books/v3/' + path,
        method: 'GET',
        url_params: query
      });
    }).then(function (res) {
      // ZFAPPS.request resolves { status_code, response|body, headers }.
      var code = res && (res.status_code || res.statusCode);
      var body = res && (res.response !== undefined ? res.response : res.body);
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* leave as text */ } }
      if (code && code >= 400) {
        var err = new Error((body && body.message) || ('Books API returned ' + code));
        err.statusCode = code;
        err.booksCode = body && body.code;
        throw err;
      }
      return body;
    });
  }

  function resize(height) {
    if (!available() || typeof ZFAPPS.invoke !== 'function') return Promise.resolve();
    return ZFAPPS.invoke('RESIZE', { height: String(height) + 'px' }).catch(function () {});
  }

  return {
    available: available,
    init: init,
    getInvoice: getInvoice,
    getOrganization: getOrganization,
    booksGet: booksGet,
    resize: resize
  };
})();
