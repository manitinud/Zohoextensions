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
   * Zoho Books widgets cannot call arbitrary URLs. Every endpoint must be
   * registered in the extension as an API Configuration (Build -> API
   * Configurations), which pins the URL, parameters and the connection used to
   * authenticate. The widget then invokes it by its generated API name:
   *
   *   ZFAPPS.request({ api_configuration_key: 'ac__in_xxxxxx_getinvoice' })
   *
   * Dynamic segments are declared in the configured URL with single braces —
   * .../invoices/{invoice_id} — and supplied at call time.
   */
  var API = {
    invoice: 'ac__in_wyw1vx3_getinvoice',
    invoicePdf: 'ac__in_wyw1vx3_getinvoicepdf',
    einvoiceQr: 'ac__in_wyw1vx3_geteinvoiceqr'
  };

  var callShape = null;   // pinned once a shape is known to work
  var shapeLog = [];

  function parseBody(res) {
    var code = res && (res.status_code || res.statusCode);
    var body = res && (res.response !== undefined ? res.response : res.body);
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* keep text */ } }
    return { code: code, body: body };
  }

  /*
   * How the placeholder values reach ZFAPPS.request is the one part of the
   * contract the sample code does not show, so the plausible shapes are tried
   * in order and the one that works is pinned for the session. Which shape won
   * is recorded so the widget can report it rather than leaving it a mystery.
   */
  function shapesFor(key, values) {
    return [
      { name: 'flat', arg: Object.assign({ api_configuration_key: key }, values) },
      { name: 'url_params', arg: { api_configuration_key: key, url_params: values } },
      { name: 'params', arg: { api_configuration_key: key, params: values } },
      { name: 'data', arg: { api_configuration_key: key, data: values } },
      { name: 'placeholders', arg: { api_configuration_key: key, placeholders: values } },
      { name: 'bare', arg: { api_configuration_key: key } }
    ];
  }

  function attempt(shape) {
    return ZFAPPS.request(shape.arg).then(function (res) {
      var p = parseBody(res);
      if (p.code && p.code >= 400) {
        var err = new Error((p.body && p.body.message) || ('Books API returned ' + p.code));
        err.statusCode = p.code;
        throw err;
      }
      return p;
    });
  }

  /*
   * `values` fill the {placeholders} in the configured URL. organization_id is
   * supplied here rather than by callers: the invoice object ZFAPPS hands over
   * does not contain it (verified against a live Books payload), so threading
   * it in from there silently passed undefined.
   */
  function callApi(key, values) {
    if (typeof ZFAPPS === 'undefined' || typeof ZFAPPS.request !== 'function') {
      return Promise.reject(new Error('ZFAPPS.request is not available in this SDK.'));
    }
    return getOrganization().then(function (o) {
      var merged = Object.assign(
        { organization_id: o && (o.organization_id || o.id) }, values || {});
      return callApiWith(key, merged);
    });
  }

  function callApiWith(key, values) {
    var shapes = shapesFor(key, values || {});
    if (callShape) {
      var pinned = shapes.filter(function (s) { return s.name === callShape; })[0];
      if (pinned) return attempt(pinned).then(function (p) { return p.body; });
    }

    var lastErr = null;
    return shapes.reduce(function (chain, shape) {
      return chain.then(function (done) {
        if (done !== undefined) return done;
        return attempt(shape).then(function (p) {
          callShape = shape.name;
          shapeLog.push(shape.name + ': ok');
          return p.body;
        }).catch(function (e) {
          lastErr = e;
          shapeLog.push(shape.name + ': ' + (e.message || 'failed'));
          // A real HTTP status means the call reached Books; the argument shape
          // was accepted and the failure is about the request itself.
          if (e.statusCode) { callShape = shape.name; throw e; }
          return undefined;
        });
      });
    }, Promise.resolve(undefined)).then(function (body) {
      if (body === undefined) {
        throw lastErr || new Error('No accepted form of ZFAPPS.request succeeded.');
      }
      return body;
    });
  }

  function getInvoiceRecord(invoiceId) {
    return callApi(API.invoice, { invoice_id: invoiceId });
  }

  /*
   * The e-invoice QR is served from a tokenised Books URL. An API Configuration
   * pins a fixed URL, so the token is lifted out of qr_link and passed as the
   * parameter the configuration declares.
   */
  function getEinvoiceQr(qrLink) {
    var m = /[?&]eInvoiceID=([^&]+)/i.exec(qrLink || '');
    if (!m) return Promise.reject(new Error('No eInvoiceID token in the QR link.'));
    return callApi(API.einvoiceQr, { eInvoiceID: decodeURIComponent(m[1]) });
  }

  function getInvoicePdf(invoiceId) {
    return callApi(API.invoicePdf, { invoice_id: invoiceId })
      .then(function (body) {
        if (body && typeof body === 'object') {
          body = body.data || body.content || body.base64 || body.body || null;
        }
        if (typeof body !== 'string' || !body) {
          throw new Error('Zoho Books did not return the invoice PDF in a readable form.');
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
    getInvoiceRecord: getInvoiceRecord,
    getInvoicePdf: getInvoicePdf,
    getEinvoiceQr: getEinvoiceQr,
    resize: resize,
    API: API,
    _shapeLog: function () { return shapeLog; },
    _callShape: function () { return callShape; },
    _shapes: shapesFor
  };
})();
