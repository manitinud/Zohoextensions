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

  /*
   * Unwrap whatever ZFAPPS.request resolved with.
   *
   * The v1 SDK wrapped payloads as {status_code, response}. Live diagnostics
   * on 2.0 showed every shape resolving 'ok' while the parsed body came out
   * undefined — the 2.0 SDK resolves with the payload DIRECTLY, and reading
   * only .response/.body was catching the envelope and discarding the letter.
   * The fallback chain covers both generations plus a .data wrapper.
   */
  /*
   * Unwrap whatever ZFAPPS.request resolved with — iteratively.
   *
   * The live 2.0 response is an HTTP exchange record:
   *   { status_message, status_code, header, body }
   * where body holds the actual payload, usually as a JSON string — and that
   * record can itself sit inside another response/body/data wrapper. One
   * unwrapping step was never enough, so this loops: peel wrapper keys,
   * parse JSON-looking strings, repeat until the payload is stable. The
   * innermost status_code wins for error detection.
   */
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

  /* One line saying what a payload IS, for the success log. */
  function payloadSummary(body) {
    if (body === null || body === undefined) return 'empty';
    if (typeof body === 'string') return 'string[' + body.length + ']';
    if (typeof body !== 'object') return typeof body;
    return 'keys: ' + Object.keys(body).slice(0, 10).join(',');
  }

  /*
   * How the placeholder values reach ZFAPPS.request is the one part of the
   * contract the sample code does not show, so the plausible shapes are tried
   * in order and the one that works is pinned for the session. Which shape won
   * is recorded so the widget can report it rather than leaving it a mystery.
   */
  /*
   * SDK 2.0 rejected every connection-less form with 'No connections are
   * provided', so the connection link is now named in the argument. Its exact
   * key spelling is undocumented here; both casings are raced first, with the
   * bare forms kept last in case the manifest declaration alone satisfies it.
   */
  var CONNECTION = 'zbooks';

  /*
   * The real contract (from Zoho's own sample for this SDK): the widget builds
   * the CONCRETE URL in JavaScript and passes it with connection_link_name —
   * the configuration's {invoice_id} template is an allowlist pattern the URL
   * must match, not something the SDK substitutes. The 70001 'Invalid url
   * provided' with literal braces proved substitution never happens.
   *
   * The URL host is fixed to .in BY CONSTRUCTION: it must match the
   * configuration's allowlisted pattern, and the configurations are saved
   * against zohoapis.in.
   */
  var BOOKS_BASE = 'https://www.zohoapis.in/books/v3';
  var QR_BASE = 'https://books.zoho.in/einvoice/qrcode';

  /*
   * The live evidence (v26): with api_configuration_key present the SDK sends
   * the configuration's STORED URL verbatim — a url passed at call time is
   * ignored, and omitting the key is refused outright. So the configured URLs
   * must be placeholder-free, and every dynamic value travels as url_params.
   * Path-style templates can never work in this SDK build.
   */
  function shapesFor(key, values) {
    /*
     * The Books API accepts the organization as the header
     * X-com-zoho-books-organizationid as well as a query parameter. With the
     * {organization_id} parameter placeholder proven to go out literally, the
     * header is the one untried channel for the org — so header-bearing
     * shapes lead.
     */
    var orgHeader = values && values.organization_id
      ? { 'X-com-zoho-books-organizationid': String(values.organization_id) }
      : null;
    var headerShapes = orgHeader ? [
      { name: 'conn+org-header',
        arg: { api_configuration_key: key, connection_link_name: CONNECTION,
               headers: orgHeader } },
      { name: 'conn+org-header+url_params',
        arg: { api_configuration_key: key, connection_link_name: CONNECTION,
               headers: orgHeader, url_params: values } }
    ] : [];
    return headerShapes.concat([
      { name: 'conn_url_params',
        arg: { api_configuration_key: key, connection_link_name: CONNECTION,
               url_params: values } },
      { name: 'conn_flat',
        arg: Object.assign({ api_configuration_key: key,
                             connection_link_name: CONNECTION }, values) },
      { name: 'url_params', arg: { api_configuration_key: key, url_params: values } }
    ]);
  }

  /*
   * Every attempt is raced against a timeout: ZFAPPS calls can neither resolve
   * nor reject, and an unbounded wait reads as a frozen widget. Shortened
   * under test via ?fastTimeouts=1 so a full sweep takes seconds.
   */
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
      /*
       * Books reports application errors inside HTTP 200 as {code, message} —
       * e.g. code 4 'Invalid value passed for invoice_id' when a placeholder
       * did not substitute. That is a failure of THIS shape, not of the whole
       * call, so it carries no statusCode: the race keeps going and a shape
       * that substitutes correctly can still win.
       */
      if (typeof p.body === 'string' && /"code"\s*:/.test(p.body)) {
        try { p.body = JSON.parse(p.body.trim()); } catch (e) { /* stays text */ }
      }
      if (typeof p.body === 'string'
          && /Invalid url provided|"status"\s*:\s*false/.test(p.body)) {
        throw new Error(p.body.slice(0, 160));
      }
      if (p.body && typeof p.body === 'object'
          && p.body.code !== undefined && Number(p.body.code) !== 0
          && !p.body.invoice && !p.body.invoices) {
        throw new Error('Books: ' + (p.body.message || ('code ' + p.body.code)));
      }
      if (p.body === null || p.body === undefined) {
        throw new Error('resolved without a payload');
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
   * Build the concrete URL (organization_id appended — required by Books and
   * absent from the invoice context object) and race the call shapes.
   */
  /*
   * GLOBALFIELDS.get/set exist on the SDK (confirmed live; they threw only
   * when probed before init). If set works, the widget writes the fields the
   * configuration placeholders read — organization_id from page context with
   * no user entry, and invoice_id per call, which makes even path templates
   * dynamic. Every form is tried once, timeout-capped, outcomes traced; a
   * working form is pinned. Failure costs nothing: the call proceeds anyway.
   */
  var gfLog = [];
  var gfForm = null;

  function trySetGlobal(name, value) {
    var gf = ZFAPPS.API && ZFAPPS.API.GLOBALFIELDS;
    if (!gf || typeof gf.set !== 'function' || value === undefined || value === null) {
      return Promise.resolve(false);
    }
    var forms = [
      { name: 'name+value', call: function () { return gf.set({ name: name, value: String(value) }); } },
      { name: 'pair', call: function () { return gf.set(name, String(value)); } },
      { name: 'map', call: function () { var m = {}; m[name] = String(value); return gf.set(m); } },
      { name: 'api_name', call: function () { return gf.set({ api_name: name, value: String(value) }); } }
    ];
    if (gfForm) forms = forms.filter(function (f) { return f.name === gfForm; });

    return forms.reduce(function (chain, form) {
      return chain.then(function (done) {
        if (done) return true;
        var p;
        try { p = form.call(); } catch (e) {
          gfLog.push('set/' + form.name + '(' + name + '): threw ' + (e.message || e));
          return false;
        }
        if (!p || typeof p.then !== 'function') {
          gfLog.push('set/' + form.name + '(' + name + '): no promise');
          return false;
        }
        return withTimeout(p, 'gf.set').then(function () {
          gfForm = form.name;
          gfLog.push('set/' + form.name + '(' + name + '): ok');
          return true;
        }, function (e) {
          gfLog.push('set/' + form.name + '(' + name + '): ' + describe(e));
          return false;
        });
      });
    }, Promise.resolve(false));
  }

  function tryGetGlobal(name) {
    var gf = ZFAPPS.API && ZFAPPS.API.GLOBALFIELDS;
    if (!gf || typeof gf.get !== 'function') return Promise.resolve();
    var p;
    try { p = gf.get(name); } catch (e) {
      gfLog.push('get(' + name + '): threw ' + (e.message || e));
      return Promise.resolve();
    }
    if (!p || typeof p.then !== 'function') {
      try { p = gf.get({ name: name }); } catch (e2) { return Promise.resolve(); }
    }
    if (!p || typeof p.then !== 'function') return Promise.resolve();
    return withTimeout(p, 'gf.get').then(function (r) {
      gfLog.push('get(' + name + '): ' + (JSON.stringify(r) || String(r)).slice(0, 120));
    }, function (e) {
      gfLog.push('get(' + name + '): ' + describe(e));
    });
  }

  function callConfigured(key, values) {
    if (typeof ZFAPPS === 'undefined' || typeof ZFAPPS.request !== 'function') {
      return Promise.reject(new Error('ZFAPPS.request is not available in this SDK.'));
    }
    return getOrganization().then(function (o) {
      var merged = Object.assign(
        { organization_id: o && (o.organization_id || o.id) }, values || {});
      // Feed the configuration's placeholders before calling; harmless if the
      // SDK refuses, decisive if it accepts.
      return trySetGlobal('organization_id', merged.organization_id)
        .then(function () { return trySetGlobal('invoice_id', merged.invoice_id); })
        .then(function () { return trySetGlobal('invoice_ids', merged.invoice_ids); })
        .then(function () { return callApiWith(key, merged); });
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
          shapeLog.push(shape.name + ': ok (' + payloadSummary(p.body) + ')');
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
   * Both routes RACE and the first success wins.
   *
   * Live behaviour showed getRecord timing out while request rejects
   * instantly; run in series that meant a full timeout of dead waiting before
   * the second route even started. They are independent reads, so whichever
   * answers first is the answer — and when both fail, the wait is one timeout,
   * with both reasons reported.
   */
  /*
   * ZFAPPS.API.getRecord hung in every live run across five argument forms;
   * it is no longer attempted — five guaranteed timeouts of pure noise.
   */
  function getInvoiceRecord(invoiceId, invoiceNumber) {
    var values = { invoice_id: invoiceId, invoice_ids: invoiceId };
    if (invoiceNumber) values.invoice_number = invoiceNumber;
    return callConfigured(API.invoice, values);
  }

  /*
   * The e-invoice QR is served from a tokenised Books URL. An API Configuration
   * pins a fixed URL, so the token is lifted out of qr_link and passed as the
   * parameter the configuration declares.
   */
  function getEinvoiceQr(qrLink) {
    var m = /[?&]eInvoiceID=([^&]+)/i.exec(qrLink || '');
    if (!m) return Promise.reject(new Error('No eInvoiceID token in the QR link.'));
    var token = decodeURIComponent(m[1]);
    return callConfigured(API.einvoiceQr, { eInvoiceID: token })
      .then(function (body) { return normaliseBinary(body, 'QR image'); });
  }

  /* Raw binary arriving as a JS string (starts '%PDF' or PNG magic) is
   * re-encoded so every caller downstream deals only in base64. */
  function binaryStringToBase64(str) {
    var out = '';
    var CHUNK = 0x8000;
    var bytes = [];
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
    for (var j = 0; j < bytes.length; j += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.slice(j, j + CHUNK));
    }
    return btoa(out);
  }

  function normaliseBinary(body, what) {
    if (body && typeof body === 'object') {
      body = body.data || body.content || body.base64 || body.body || null;
    }
    if (typeof body !== 'string' || !body) {
      throw new Error('Zoho Books did not return the ' + what + ' in a readable form.');
    }
    if (body.slice(0, 5) === '%PDF-' || body.charCodeAt(0) === 0x89) {
      return binaryStringToBase64(body);
    }
    return body;
  }

  /*
   * The e-invoice record from the placeholder-free /invoices/einvoice endpoint
   * (verified to exist live: it demands invoice_ids). Whether this connection
   * is scoped for it is answered by the response, which the caller traces.
   */
  function getEinvoiceInfo(invoiceId) {
    return callConfigured(API.einvoiceQr, { invoice_ids: invoiceId, invoice_id: invoiceId });
  }

  function getInvoicePdf(invoiceId) {
    return callConfigured(API.invoicePdf,
        { invoice_id: invoiceId, invoice_ids: invoiceId, accept: 'pdf' })
      .then(function (body) { return normaliseBinary(body, 'invoice PDF'); });
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
    getEinvoiceInfo: getEinvoiceInfo,
    apiGetRecord: apiGetRecord,
    resize: resize,
    timeout: withTimeout,
    tryGetGlobal: tryGetGlobal,
    _gfLog: function () { return gfLog; },
    API: API,
    _shapeLog: function () { return shapeLog; },
    _callShape: function () { return callShape; },
    _shapes: shapesFor,
    _describe: describe
  };
})();
