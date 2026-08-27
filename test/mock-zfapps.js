/*
 * A stand-in for the ZFAPPS SDK, built from what the real one was observed to
 * do inside a live Zoho Books organization.
 *
 * This exists so the widget can be exercised here instead of in someone's
 * production org. Everything it models was seen in a real run:
 *
 *   - the exact member list ZFAPPS exposes
 *   - get('invoice') returning an invoice with NO einvoice_details
 *   - extension.init() and request() that hang: neither resolving nor
 *     rejecting, which is what made earlier failures look like freezes
 *
 * Scenarios drive the parts that vary, so each can be tested deliberately
 * rather than discovered on a client's screen.
 */
function buildMockScript(scenario) {
  return `
(function () {
  var SCENARIO = ${JSON.stringify(scenario)};
  var never = function () { return new Promise(function () {}); };

  // Verbatim from a live org's diagnostics dump.
  var MEMBERS = ['API', 'I18N', 'UI', 'closeModal', 'extension', 'get', 'hideWidget',
                 'invoke', 'linkFiles', 'request', 'retrieve', 'set', 'showModal',
                 'showWidget', 'store'];

  // The invoice ZFAPPS hands a widget: no einvoice_details, no organization_id.
  var INVOICE = {
    invoice_id: '3232508000003094940',
    invoice_number: 'AVMF/26-27/056',
    date: '2026-07-31',
    customer_name: 'Limson INC',
    total: 94554,
    currency_code: 'USD'
  };
  // The live context invoice carries 117 fields; pad it so the scan runs
  // against something realistically large.
  for (var i = 0; i < 111; i++) { INVOICE['filler_field_' + i] = 'x'; }

  if (SCENARIO.einvoiceInContext) {
    INVOICE.einvoice_details = {
      inv_ref_num: '56261ce5227241efb114a6d60617be398be0923f8fa39fec330407ce110be1ef',
      ack_number: '112631363872267', ack_date: '2026-07-09 11:12:00',
      status_formatted: 'Pushed',
      qr_link: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c'
    };
  }

  var ORG = { organization_id: '60058776365', name: 'Adivishnu Marine Foods Pvt Ltd' };

  var EINVOICE_DETAILS = {
    inv_ref_num: '56261ce5227241efb114a6d60617be398be0923f8fa39fec330407ce110be1ef',
    status_formatted: 'Pushed',
    ack_number: '112631363872267',
    status: 'pushed',
    formatted_status: 'Pushed',
    ack_date: '2026-07-09 11:12:00',
    qr_link: 'https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c64ec31e389'
  };

  window.__mockCalls = [];

  var ZFAPPS = {
    // Observed live: ZFAPPS.API exposes record CRUD, which is the SDK's own
    // route to a Books record.
    API: {
      createRecord: function () { return Promise.resolve({}); },
      deleteRecord: function () { return Promise.resolve({}); },
      getAllRecords: function () { return Promise.resolve({}); },
      updateRecord: function () { return Promise.resolve({}); },
      getRecord: function (arg) {
        window.__mockCalls.push({ getRecord: JSON.parse(JSON.stringify(arg)) });
        if (SCENARIO.getRecordHangs) return never();
        var accepted = SCENARIO.getRecordShape;
        if (accepted) {
          var keys = Object.keys(arg).sort().join('+');
          var wanted = {
            'module+id': 'id+module',
            'entity+id': 'entity+id',
            'module+record_id': 'module+record_id',
            'entity+entity_id': 'entity+entity_id',
            'module+invoice_id': 'invoice_id+module'
          }[accepted];
          if (keys !== wanted) return never();
        }
        var inv = JSON.parse(JSON.stringify(INVOICE));
        inv.einvoice_details = EINVOICE_DETAILS;
        return Promise.resolve({ invoice: inv });
      }
    },
    I18N: {},
    UI: {},
    closeModal: function () {},
    hideWidget: function () {},
    showModal: function () {},
    showWidget: function () {},
    linkFiles: function () {},
    retrieve: function () { return Promise.resolve(null); },
    store: function () { return Promise.resolve(); },
    set: function () { return Promise.resolve(); },
    invoke: function () { return Promise.resolve(); },

    extension: {
      init: function () {
        if (SCENARIO.initHangs) return never();
        if (SCENARIO.initRejects) return Promise.reject(new Error('init refused'));
        return Promise.resolve({ instance: { on: function () {} } });
      }
    },

    get: function (entity) {
      if (entity === 'invoice') return Promise.resolve({ invoice: INVOICE });
      if (entity === 'organization') return Promise.resolve({ organization: ORG });
      // Dotted-path gets: unknown paths may hang like everything else here.
      if (SCENARIO.pathGetWorks && entity === 'invoice.einvoice_details') {
        return Promise.resolve({ 'invoice.einvoice_details': EINVOICE_DETAILS });
      }
      if (SCENARIO.unknownGetHangs) return never();
      return Promise.resolve(null);
    },

    request: function (arg) {
      window.__mockCalls.push(JSON.parse(JSON.stringify(arg)));

      if (SCENARIO.requestHangs) return never();

      // The behaviour seen live in v16-v17: request rejects IMMEDIATELY with a
      // plain object or string, never an Error instance.
      if (SCENARIO.requestRejectsWith !== undefined) {
        return Promise.reject(SCENARIO.requestRejectsWith);
      }

      if (SCENARIO.requireOrgHeader) {
        var h = arg.headers || {};
        if (h['X-com-zoho-books-organizationid'] !== '60058776365') {
          return Promise.resolve({ status_code: 200,
            response: JSON.stringify({ code: 6, message:
              'This user belongs to multiple organizations, hence the parameter '
              + 'CompanyID/CompanyName is required for associating this user to a '
              + 'specific organization.', status: false }) });
        }
      }

      // SDK 2.0 live behaviour: a configured call without the connection named
      // is rejected with this exact string.
      if (SCENARIO.requireConnection
          && arg.connection_link_name !== 'zbooks'
          && arg.connectionLinkName !== 'zbooks') {
        return Promise.reject('No connections are provided');
      }

      // The real SDK only honours one argument shape; the rest hang. Modelling
      // that is the point — a shape that hangs must not stall the whole run.
      var shapeOk = SCENARIO.acceptShape
        ? arg[SCENARIO.acceptShape] !== undefined
          || (SCENARIO.acceptShape === 'flat' && arg.invoice_id !== undefined)
          || (SCENARIO.acceptShape === 'flat' && arg.eInvoiceID !== undefined)
        : true;
      if (!shapeOk) return never();

      // URL-style calls (the real contract): route by the concrete URL.
      if (typeof arg.url === 'string') {
        if (!arg.connection_link_name && !arg.connectionLinkName) {
          return Promise.reject('No connections are provided');
        }
        var u = arg.url;
        function respondUrl(payload) {
          if (SCENARIO.exchangeRecord) {
            return Promise.resolve({ status_message: 'OK', status_code: 200, header: {},
              body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
          }
          return Promise.resolve({ status_code: 200, response: payload });
        }
        if (u.indexOf('qrcode') !== -1) return respondUrl(SCENARIO.qrBase64 || '');
        if (u.indexOf('accept=pdf') !== -1) return respondUrl(SCENARIO.pdfBase64 || '');
        if (u.indexOf('/invoices/' + INVOICE.invoice_id) !== -1) {
          var uinv = JSON.parse(JSON.stringify(INVOICE));
          uinv.einvoice_details = EINVOICE_DETAILS;
          return respondUrl({ code: 0, message: 'success', invoice: uinv });
        }
        // The live 70001, verbatim, as a STRING body — the parse gap we hit.
        return respondUrl('{"code":70001,"message":"Invalid url provided.(' + u
          + ')","status":false}');
      }

      var key = arg.api_configuration_key || '';
      if (SCENARIO.booksCodeUnlessFlat && arg.invoice_id === undefined) {
        return Promise.resolve({ status_code: 200,
          response: { code: 4, message: 'Invalid value passed for invoice_id' } });
      }

      // Two response generations, both seen or implied live:
      //   wrapper: {status_code, response: payload}  (v1-style)
      //   direct:  the payload itself                (2.0 — confirmed live,
      //            where .response parsing yielded undefined)
      function respond(payload) {
        // The shape confirmed live in v23 diagnostics: an HTTP exchange record
        // whose body carries the payload as a JSON string.
        if (SCENARIO.exchangeRecord) {
          return Promise.resolve({
            status_message: 'OK', status_code: 200, header: {},
            body: typeof payload === 'string' ? payload : JSON.stringify(payload)
          });
        }
        if (SCENARIO.directPayload) return Promise.resolve(payload);
        return Promise.resolve({ status_code: 200, response: payload });
      }

      if (key.indexOf('getinvoicepdf') !== -1) return respond(SCENARIO.pdfBase64 || '');
      if (key.indexOf('geteinvoiceqr') !== -1) return respond(SCENARIO.qrBase64 || '');
      if (key.indexOf('getinvoice') !== -1) {
        // Live v32: the stored URL's {vl__...} placeholder goes out literally
        // right after a successful GLOBALFIELDS.set, then substitution catches
        // up. Model that: fail every call in the first second, succeed after.
        if (SCENARIO.literalUntilRetry) {
          window.__literalFirstAt = window.__literalFirstAt || Date.now();
          if (Date.now() - window.__literalFirstAt < 1000) {
            return respond('{"code":70001,"message":"Invalid url provided.('
              + 'https://www.zohoapis.in/books/v3/invoices?organization_id='
              + '{vl__in_wyw1vx3_organization_id})","status":false}');
          }
        }
        if (SCENARIO.listResponse) {
          var target = JSON.parse(JSON.stringify(INVOICE));
          target.einvoice_details = EINVOICE_DETAILS;
          var decoy = { invoice_id: '999', invoice_number: 'OTHER/001',
                        einvoice_details: { inv_ref_num: 'WRONG_IRN_DO_NOT_PRINT',
                                            ack_number: '000' } };
          return respond({ code: 0, message: 'success', invoices: [decoy, target] });
        }
        var inv = JSON.parse(JSON.stringify(INVOICE));
        inv.einvoice_details = EINVOICE_DETAILS;
        return respond({ code: 0, message: 'success', invoice: inv });
      }
      return respond({ code: 5, message: 'no such configuration' });
    }
  };

  MEMBERS.forEach(function (m) { if (!(m in ZFAPPS)) ZFAPPS[m] = function () {}; });
  window.ZFAPPS = ZFAPPS;
})();
`;
}

module.exports = { buildMockScript };
