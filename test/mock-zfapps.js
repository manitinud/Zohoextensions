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
    API: {},
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
      return Promise.resolve(null);
    },

    request: function (arg) {
      window.__mockCalls.push(JSON.parse(JSON.stringify(arg)));

      if (SCENARIO.requestHangs) return never();

      // The real SDK only honours one argument shape; the rest hang. Modelling
      // that is the point — a shape that hangs must not stall the whole run.
      var shapeOk = SCENARIO.acceptShape
        ? arg[SCENARIO.acceptShape] !== undefined
          || (SCENARIO.acceptShape === 'flat' && arg.invoice_id !== undefined)
          || (SCENARIO.acceptShape === 'flat' && arg.eInvoiceID !== undefined)
        : true;
      if (!shapeOk) return never();

      var key = arg.api_configuration_key || '';
      if (key.indexOf('getinvoicepdf') !== -1) {
        return Promise.resolve({ status_code: 200, response: SCENARIO.pdfBase64 || '' });
      }
      if (key.indexOf('geteinvoiceqr') !== -1) {
        return Promise.resolve({ status_code: 200, response: SCENARIO.qrBase64 || '' });
      }
      if (key.indexOf('getinvoice') !== -1) {
        var inv = JSON.parse(JSON.stringify(INVOICE));
        inv.einvoice_details = EINVOICE_DETAILS;
        return Promise.resolve({ status_code: 200, response: { invoice: inv } });
      }
      return Promise.resolve({ status_code: 404, response: { message: 'no such configuration' } });
    }
  };

  MEMBERS.forEach(function (m) { if (!(m in ZFAPPS)) ZFAPPS[m] = function () {}; });
  window.ZFAPPS = ZFAPPS;
})();
`;
}

module.exports = { buildMockScript };
