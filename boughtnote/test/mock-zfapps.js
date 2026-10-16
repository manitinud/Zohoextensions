/*
 * Mock ZFAPPS for the Bought Note widget, modelling the SDK behaviour proven
 * live by the e-Invoice Print extension in the same organization: hangs,
 * plain-object rejections, exchange-record responses, the url_param
 * substitution contract, and connection enforcement.
 */
function buildMockScript(scenario) {
  return `
(function () {
  var SCENARIO = ${JSON.stringify(scenario)};
  var never = function () { return new Promise(function () {}); };

  var BILL_LIST = {
    bill_id: '3232508000001298177',
    bill_number: 'ZYL(P)/26-27/76',
    date: '2026-04-14',
    vendor_id: 'v900',
    vendor_name: 'P. Satyanarayana',
    total: 498069
  };

  var BILL_FULL = {
    bill_id: '3232508000001298177',
    bill_number: 'ZYL(P)/26-27/76',
    date: '2026-04-14',
    vendor_id: 'v900',
    vendor_name: 'P. Satyanarayana',
    tds_percent: '0.10', tds_amount: 498.07,
    total: 498069,
    line_items: [
      { name: 'Vannamei Stock', description: '103 C', quantity: 1098.8, rate: 257,
        item_total: 282391.6, item_custom_fields: [] },
      { name: 'Vannamei Stock', description: '106.5 C', quantity: 850.8, rate: 253.5,
        item_total: 215677.8,
        item_custom_fields: [{ api_name: 'cf_count', value: 106.5 }] }
    ]
  };

  var VENDOR = { contact_id: 'v900', contact_name: 'P. Satyanarayana',
    pan_no: 'AAAAA0000A',
    billing_address: { address: 'Main Road', city: 'Kakinada' } };

  var ORG = { organization_id: '60000000001', name: 'Zylker Exports Pvt Ltd',
              gst_no: '37AAAAA0000A1Z5' };

  window.__mockCalls = [];

  var ZFAPPS = {
    API: {},
    I18N: {}, UI: {},
    closeModal: function () {}, hideWidget: function () {}, showModal: function () {},
    showWidget: function () {}, linkFiles: function () {},
    retrieve: function () { return Promise.resolve(null); },
    store: function () { return Promise.resolve(); },
    set: function () { return Promise.resolve(); },
    invoke: function () { return Promise.resolve(); },

    extension: {
      init: function () {
        if (SCENARIO.initHangs) return never();
        return Promise.resolve({ instance: { on: function () {} } });
      }
    },

    get: function (entity) {
      if (entity === 'bill') return Promise.resolve({ bill: BILL_LIST });
      if (entity === 'organization') return Promise.resolve({ organization: ORG });
      if (SCENARIO.unknownGetHangs) return never();
      return Promise.resolve(null);
    },

    request: function (arg) {
      window.__mockCalls.push(JSON.parse(JSON.stringify(arg)));
      if (SCENARIO.requestHangs) return never();

      if (SCENARIO.requireConnection
          && arg.connection_link_name !== 'zbooksbn') {
        return Promise.reject('No connections are provided');
      }

      var key = arg.api_configuration_key || '';
      var up = arg.url_param || {};

      // The live contract: without a url_param OBJECT carrying the values,
      // the stored URL goes out with the placeholder literal.
      if (SCENARIO.requireUrlParam) {
        if (Array.isArray(arg.url_param) || Array.isArray(arg.url_query)) {
          return Promise.reject('JSON is not well formed');
        }
        var needed = key.indexOf('getvendor') !== -1 ? 'contact_id' : 'bill_id';
        if (!up[needed] || up.organization_id !== '60000000001') {
          return respond('{"code":70001,"message":"Invalid url provided.('
            + 'https://www.zohoapis.in/books/v3/x/{url_param.' + needed
            + '})","status":false}');
        }
      }

      function respond(payload) {
        // The live 2.0 shape: an HTTP exchange record, body as a JSON string.
        return Promise.resolve({ status_message: 'OK', status_code: 200, header: {},
          body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
      }

      if (key.indexOf('getbill') !== -1) {
        if (SCENARIO.billApiFails) {
          return respond({ code: 5, message: 'no such configuration' });
        }
        return respond({ code: 0, message: 'success', bill: BILL_FULL });
      }
      if (key.indexOf('getvendor') !== -1) {
        return respond({ code: 0, message: 'success', contact: VENDOR });
      }
      return respond({ code: 5, message: 'no such configuration' });
    }
  };

  window.ZFAPPS = ZFAPPS;
})();
`;
}

module.exports = { buildMockScript };
