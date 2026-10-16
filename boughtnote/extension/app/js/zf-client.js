/*
 * Thin wrapper over the Zoho Finance extensions SDK (ZFAPPS) for the Bought
 * Note widget. Everything here is the contract proven live by the e-Invoice
 * Print extension in this same organization:
 *
 *   - the 2.0 SDK is required for API Configurations
 *   - every call names the connection (connection_link_name)
 *   - the stored URL carries ${url_param.<name>} placeholders and the widget
 *     supplies values as a PLAIN OBJECT under url_param (arrays draw "JSON is
 *     not well formed"; headers-plural and url_params are silently ignored)
 *   - responses arrive as an HTTP exchange record whose body is a JSON string,
 *     possibly nested — parsing must iterate
 *   - calls can hang forever, so every attempt races a timeout
 *   - rejections are plain objects/strings, never Error instances
 */
var ZFClient = (function () {
  var org = null;

  function available() {
    return typeof ZFAPPS !== 'undefined' && ZFAPPS && ZFAPPS.extension;
  }

  function init() {
    if (!available()) {
      return Promise.reject(new Error(
        'ZFAPPS SDK not available. This page must run as a Zoho Books extension widget.'));
    }
    return ZFAPPS.extension.init();
  }

  function unwrap(res, key) {
    if (!res) return null;
    return res[key] !== undefined ? res[key] : res;
  }

  // The bill page's context entity. 'bill' is the natural name; the raw
  // response is kept reachable for diagnostics if the key differs live.
  function getBillContext() {
    return ZFAPPS.get('bill').then(function (r) { return unwrap(r, 'bill'); });
  }

  function getOrganization() {
    if (org) return Promise.resolve(org);
    return ZFAPPS.get('organization').then(function (r) {
      org = unwrap(r, 'organization');
      return org;
    });
  }

  /*
   * API Configurations, by their generated API names. NS is the extension
   * namespace the Developer Portal assigns when the extension is created —
   * visible in any generated name (ac__<NS>_getbill). Update NS once, here.
   */
  var NS = 'in_PENDING';
  var API = {
    bill: 'ac__' + NS + '_getbill',
    vendor: 'ac__' + NS + '_getvendor'
  };

  var CONNECTION = 'zbooksbn';
  var callShape = null;
  var shapeLog = [];

  /* Render whatever a promise rejected with — the SDK rejects with plain
   * objects and strings, and e.message alone discards the reason. */
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
    } catch (err) { /* circular */ }
    var keys = [];
    try { for (var k2 in e) keys.push(k2); } catch (err) { /* ignore */ }
    return keys.length ? 'object with keys: ' + keys.join(', ') : String(e);
  }

  /* Unwrap the response iteratively: exchange records nest, bodies arrive as
   * JSON strings, and the innermost status_code wins. */
  function parseBody(res) {
    var code;
    var body = res;
    var guard = 0;
    while (guard++ < 8) {
      if (body && typeof body === 'object') {
        var sc = body.status_code || body.statusCode;
        if (sc) code = sc;
        var next;
        if (body.response !== undefined) next = body.response;
        else if (body.body !== undefined) next = body.body;
        else if (body.data !== undefined) next = body.data;
        if (next !== undefined && next !== body) { body = next; continue; }
      }
      if (typeof body === 'string' && /^[\s]*[{\[]/.test(body)) {
        try { body = JSON.parse(body); continue; } catch (e) { /* plain text */ }
      }
      break;
    }
    return { code: code, body: body };
  }

  function payloadSummary(body) {
    if (body === null || body === undefined) return 'empty';
    if (typeof body === 'string') return 'string[' + body.length + ']';
    if (typeof body !== 'object') return typeof body;
    return 'keys: ' + Object.keys(body).slice(0, 10).join(',');
  }

  /*
   * The documented contract: url_param is a PLAIN OBJECT whose entries fill
   * ${url_param.<name>} in the stored URL. The flat form is kept as the one
   * fallback; everything proven dead live is left out.
   */
  function shapesFor(key, values) {
    var strung = {};
    Object.keys(values || {}).forEach(function (k) {
      if (values[k] !== undefined && values[k] !== null) {
        strung[k] = String(values[k]);
      }
    });
    return [
      { name: 'conn+url_param',
        arg: { api_configuration_key: key, connection_link_name: CONNECTION,
               url_param: strung } },
      { name: 'conn_flat',
        arg: Object.assign({ api_configuration_key: key,
                             connection_link_name: CONNECTION }, strung) }
    ];
  }

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
        e.timedOut = true; e.label = label;
        reject(e);
      }, ATTEMPT_TIMEOUT_MS);
      promise.then(function (v) {
        if (settled) return; settled = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (settled) return; settled = true; clearTimeout(timer); reject(e);
      });
    });
  }

  function attempt(shape) {
    var call;
    try { call = ZFAPPS.request(shape.arg); }
    catch (e) { return Promise.reject(e); }
    if (!call || typeof call.then !== 'function') {
      return Promise.reject(new Error('request() returned no promise'));
    }
    return withTimeout(call, shape.name).then(function (res) {
      var parsed = parseBody(res);
      var body = parsed.body;
      // Books app errors arrive inside HTTP 200; error-looking strings must
      // be surfaced, not treated as a payload.
      if (typeof body === 'string'
          && /Invalid url provided|"status"\s*:\s*false|"code"\s*:/.test(body)) {
        try { body = JSON.parse(body); } catch (e) { throw new Error(body.slice(0, 500)); }
      }
      if (body && typeof body === 'object' && body.code !== undefined
          && Number(body.code) !== 0 && !body.bill && !body.contact) {
        var err = new Error('Books: ' + (body.message || ('code ' + body.code)));
        throw err;
      }
      if (body === null || body === undefined || body === '') {
        throw new Error('empty response');
      }
      if (parsed.code && Number(parsed.code) >= 400) {
        var e2 = new Error('HTTP ' + parsed.code + ': ' + payloadSummary(body));
        e2.statusCode = parsed.code;
        throw e2;
      }
      return { body: body };
    });
  }

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
          shapeLog.push(shape.name + ': ok (' + payloadSummary(p.body) + ')');
          if (settled) return;
          settled = true;
          callShape = shape.name;
          resolve(p.body);
        }).catch(function (e) {
          shapeLog.push(shape.name + ': ' + describe(e));
          errors.push(shape.name + ' - ' + describe(e));
          if (e.statusCode && !settled) {
            settled = true; callShape = shape.name; reject(e); return;
          }
          if (--pending === 0 && !settled) {
            settled = true;
            reject(new Error('no argument form was accepted (' + errors.join('; ') + ')'));
          }
        });
      });
    });
  }

  function callConfigured(key, values) {
    if (typeof ZFAPPS === 'undefined' || typeof ZFAPPS.request !== 'function') {
      return Promise.reject(new Error('ZFAPPS.request is not available in this SDK.'));
    }
    return getOrganization().then(function (o) {
      var merged = Object.assign(
        { organization_id: o && (o.organization_id || o.id) }, values || {});
      return callApiWith(key, merged)
        .catch(function (err) { return retryOnLiteral(key, merged, err); });
    });
  }

  // Substitution occasionally lags: one delayed retry when the stored URL
  // went out with the placeholder literal.
  function retryOnLiteral(key, values, err) {
    if (!err || !/Invalid url provided.*\{(vl__|url_param\.)/.test(err.message || '')) throw err;
    shapeLog.push('placeholder went out literally - retrying once after 1800ms');
    return new Promise(function (r) { setTimeout(r, 1800); })
      .then(function () { return callApiWith(key, values); });
  }

  // GET /bills/${url_param.bill_id} — the bill detail record.
  function getBill(billId) {
    return callConfigured(API.bill, { bill_id: billId });
  }

  // GET /contacts/${url_param.contact_id} — the vendor, for PAN and address.
  function getVendor(contactId) {
    return callConfigured(API.vendor, { contact_id: contactId });
  }

  function resize(height) {
    if (!available() || typeof ZFAPPS.invoke !== 'function') return Promise.resolve();
    return ZFAPPS.invoke('RESIZE', { height: String(height) + 'px' }).catch(function () {});
  }

  return {
    available: available,
    init: init,
    getBillContext: getBillContext,
    getOrganization: getOrganization,
    getBill: getBill,
    getVendor: getVendor,
    resize: resize,
    timeout: withTimeout,
    API: API,
    _shapeLog: function () { return shapeLog; },
    _callShape: function () { return callShape; },
    _shapes: shapesFor,
    _describe: describe,
    _parseBody: parseBody
  };
})();
