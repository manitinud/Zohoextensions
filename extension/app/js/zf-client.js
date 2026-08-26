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
  var apiBase = null; // resolved once, then reused

  /*
   * Zoho runs per data centre and the API domain must match the one the org
   * lives in: an org on books.zoho.in must be queried at zohoapis.in, and a
   * request to zohoapis.com fails rather than redirecting. The widget runs in
   * an iframe, so the host domain is read from the embedding page.
   */
  var DC_DOMAINS = ['in', 'com', 'eu', 'com.au', 'jp', 'sa', 'ca', 'com.cn'];

  function hostDomain() {
    var host = '';
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        host = new URL(window.location.ancestorOrigins[0]).hostname;
      } else if (document.referrer) {
        host = new URL(document.referrer).hostname;
      }
    } catch (e) { /* cross-origin restrictions - fall through to probing */ }

    // books.zoho.in -> in, books.zoho.com.au -> com.au, and so on.
    var m = host.match(/zoho\.(com\.au|com\.cn|eu|in|jp|sa|ca|com)$/);
    return m ? m[1] : null;
  }

  function candidateBases() {
    var detected = hostDomain();
    var order = detected
      ? [detected].concat(DC_DOMAINS.filter(function (d) { return d !== detected; }))
      : DC_DOMAINS.slice();
    return order.map(function (d) { return 'https://www.zohoapis.' + d + '/books/v3/'; });
  }

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

  function parseBody(res) {
    var code = res && (res.status_code || res.statusCode);
    var body = res && (res.response !== undefined ? res.response : res.body);
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* keep text */ } }
    return { code: code, body: body };
  }

  function requestOnce(base, path, query) {
    return ZFAPPS.request({
      url: base + path,
      method: 'GET',
      url_params: query
    }).then(function (res) {
      var p = parseBody(res);
      if (p.code && p.code >= 400) {
        var err = new Error((p.body && p.body.message) || ('Books API returned ' + p.code));
        err.statusCode = p.code;
        err.booksCode = p.body && p.body.code;
        throw err;
      }
      return p.body;
    });
  }

  /*
   * GET against the Books API through the ZFAPPS proxy.
   *
   * `path` is relative to the Books API root, e.g. 'invoices/12345'.
   *
   * The first call probes data-centre domains in turn until one answers, then
   * pins that base for the rest of the session. Probing stops at the first
   * response that is not a transport/host failure: an authenticated 401 or a
   * "not found" from the right data centre is a real answer and must not send
   * us on to the next domain.
   */
  function booksGet(path, params) {
    return getOrganization().then(function (o) {
      var query = Object.assign({ organization_id: o && (o.organization_id || o.id) }, params || {});

      if (apiBase) return requestOnce(apiBase, path, query);

      var bases = candidateBases();
      var lastErr = null;

      return bases.reduce(function (chain, base) {
        return chain.then(function (result) {
          if (result !== undefined) return result;
          return requestOnce(base, path, query).then(function (body) {
            apiBase = base;
            return body;
          }).catch(function (e) {
            lastErr = e;
            // A response from the server (any HTTP status) means the domain is
            // right; only keep probing when the host itself did not answer.
            if (e.statusCode) { apiBase = base; throw e; }
            return undefined;
          });
        });
      }, Promise.resolve(undefined)).then(function (result) {
        if (result === undefined) {
          throw lastErr || new Error('Could not reach the Zoho Books API from this widget.');
        }
        return result;
      });
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
    resize: resize,
    _hostDomain: hostDomain,
    _candidateBases: candidateBases
  };
})();
