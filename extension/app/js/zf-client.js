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

  /*
   * Render whatever a promise rejected with.
   *
   * The SDK rejects with plain objects and strings, not Error instances, so
   * reading e.message discarded the reason entirely and every distinct failure
   * was logged as the same word. The actual payload is the only thing that
   * says what Zoho objected to.
   */
  function describe(e) {
    if (e === null || e === undefined) return 'rejected with ' + String(e);
    if (typeof e === 'string') return e;
    if (e instanceof Error && e.message) return e.message;
    if (e.message && typeof e.message === 'string') return e.message;
    var parts = [];
    ['code', 'status', 'status_code', 'statusCode', 'error', 'error_message',
     'message', 'description', 'reason', 'details'].forEach(function (k) {
      if (e[k] !== undefined && typeof e[k] !== 'object') parts.push(k + '=' + e[k]);
    });
    if (parts.length) return parts.join(' ');
    try {
      var j = JSON.stringify(e);
      if (j && j !== '{}') return j.slice(0, 400);
    } catch (err) { /* circular or hostile */ }
    var keys = [];
    try { for (var k2 in e) keys.push(k2); } catch (err) { /* ignore */ }
    return keys.length ? 'object with keys: ' + keys.join(', ') : String(e);
  }

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

  /*
   * Every attempt is raced against a timeout.
   *
   * ZFAPPS.request can neither resolve nor reject — a rejected configuration
   * simply never settles. Without a deadline the widget sits on "Reading
   * e-invoice details" indefinitely, which reads as a hang rather than a
   * failure and hides whatever the remaining shapes would have told us.
   */
  // Shortened under test so a full six-shape sweep takes seconds rather than
  // minutes; the flag is only ever set by the local harness.
  var ATTEMPT_TIMEOUT_MS =
    (typeof location !== 'undefined' && /[?&]fastTimeouts=1/.test(location.search))
      ? 700 : 8000;

  function withTimeout(promise, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        var e = new Error('no response within ' + (ATTEMPT_TIMEOUT_MS / 1000) + 's');
        e.timedOut = true;
        reject(e);
      }, ATTEMPT_TIMEOUT_MS);
      promise.then(function (v) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(e);
      });
    });
  }

  function attempt(shape) {
    var call;
    try { call = ZFAPPS.request(shape.arg); }
    catch (e) { return Promise.reject(e); }
    if (!call || typeof call.then !== 'function') {
      return Promise.reject(new Error('ZFAPPS.request did not return a promise'));
    }
    return withTimeout(call, shape.name).then(function (res) {
      var p = parseBody(res);
      if (p.code && p.code >= 400) {
        var err = new Error((p.body && p.body.message) || ('Books API returned ' + p.code));
        err.statusCode = p.code;
        err.raw = p.body;
        throw err;
      }
      return p;
    }, function (raw) {
      // Preserve the original payload; describe() is what finally reads it.
      var err = new Error(describe(raw));
      err.raw = raw;
      if (raw && (raw.status_code || raw.statusCode)) {
        err.statusCode = raw.status_code || raw.statusCode;
      }
      throw err;
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

  /*
   * All candidate shapes are attempted CONCURRENTLY and the first success wins.
   *
   * Run in series this cost six timeouts back to back — over a minute of dead
   * waiting before the panel said anything. The attempts are independent and
   * the calls are read-only, so there is no reason to serialise them: the wait
   * is now one timeout regardless of how many shapes are tried.
   */
  function callApiWith(key, values) {
    var shapes = shapesFor(key, values || {});
    if (callShape) {
      var pinned = shapes.filter(function (s) { return s.name === callShape; })[0];
      if (pinned) return attempt(pinned).then(function (p) { return p.body; });
    }

    return new Promise(function (resolve, reject) {
      var settled = false;
      var pending = shapes.length;
      var errors = [];

      shapes.forEach(function (shape) {
        attempt(shape).then(function (p) {
          shapeLog.push(shape.name + ': ok');
          if (settled) return;
          settled = true;
          callShape = shape.name;
          resolve(p.body);
        }).catch(function (e) {
          shapeLog.push(shape.name + ': ' + describe(e));
          errors.push(shape.name + ' - ' + describe(e));
          // An HTTP status means the call reached Books and it objected; that
          // is a real answer and worth surfacing over a pile of timeouts.
          if (e.statusCode && !settled) {
            settled = true;
            callShape = shape.name;
            reject(e);
            return;
          }
          if (--pending === 0 && !settled) {
            settled = true;
            reject(new Error('no argument form was accepted (' + errors.join('; ') + ')'));
          }
        });
      });
    });
  }

  /*
   * Reading a Books record goes through ZFAPPS.API.getRecord, not
   * ZFAPPS.request.
   *
   * A live runtime dump showed ZFAPPS.API exposes createRecord, deleteRecord,
   * getAllRecords, getRecord and updateRecord. ZFAPPS.request is for external
   * services reached via an API Configuration, which is why every argument form
   * of it was refused for a Books endpoint: right method, wrong door.
   *
   * getRecord's parameter names are not documented here, so the plausible
   * spellings are raced the same way and the winner is reported.
   */
  function getRecordShapes(invoiceId) {
    return [
      { name: 'module+id', arg: { module: 'invoices', id: invoiceId } },
      { name: 'entity+id', arg: { entity: 'invoice', id: invoiceId } },
      { name: 'module+record_id', arg: { module: 'invoices', record_id: invoiceId } },
      { name: 'entity+entity_id', arg: { entity: 'invoice', entity_id: invoiceId } },
      { name: 'module+invoice_id', arg: { module: 'invoices', invoice_id: invoiceId } }
    ];
  }

  function apiGetRecord(invoiceId) {
    if (!ZFAPPS.API || typeof ZFAPPS.API.getRecord !== 'function') {
      return Promise.reject(new Error('ZFAPPS.API.getRecord is not available.'));
    }
    var shapes = getRecordShapes(invoiceId);

    return new Promise(function (resolve, reject) {
      var settled = false, pending = shapes.length, errs = [];
      shapes.forEach(function (shape) {
        var call;
        try { call = ZFAPPS.API.getRecord(shape.arg); }
        catch (e) { call = Promise.reject(e); }
        if (!call || typeof call.then !== 'function') {
          call = Promise.reject(new Error('did not return a promise'));
        }
        withTimeout(call, shape.name).then(function (res) {
          var body = res && (res.invoice || res.response || res.data || res);
          shapeLog.push('getRecord/' + shape.name + ': ok');
          if (settled) return;
          settled = true;
          callShape = 'getRecord/' + shape.name;
          resolve(body);
        }).catch(function (e) {
          shapeLog.push('getRecord/' + shape.name + ': ' + describe(e));
          errs.push(shape.name + ' - ' + describe(e));
          if (--pending === 0 && !settled) {
            settled = true;
            reject(new Error('getRecord refused every form (' + errs.join('; ') + ')'));
          }
        });
      });
    });
  }

  /*
   * getRecord first, since it is the SDK's own route to a Books record; the
   * API Configuration is kept as a fallback because it is already set up.
   */
  function getInvoiceRecord(invoiceId) {
    return apiGetRecord(invoiceId).catch(function (recordErr) {
      return callApi(API.invoice, { invoice_id: invoiceId })
        .catch(function (cfgErr) {
          throw new Error(recordErr.message + ' | configuration route: ' + cfgErr.message);
        });
    });
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
    apiGetRecord: apiGetRecord,
    resize: resize,
    API: API,
    _shapeLog: function () { return shapeLog; },
    _callShape: function () { return callShape; },
    _shapes: shapesFor,
    _describe: describe
  };
})();
