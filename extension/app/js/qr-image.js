/*
 * Gets the e-invoice QR into the printed copy.
 *
 * Zoho Books serves the QR at einvoice_details.qr_link. That image is the IRP's
 * signed QR — the extension neither generates nor re-encodes it.
 *
 * Widgets cannot request arbitrary URLs, so the fetch goes through an API
 * Configuration registered on the extension, with the token from qr_link passed
 * as its parameter.
 *
 * The bytes are inlined as a data URI rather than left as a remote reference:
 * the printed PDF is usually saved, and a remote <img> would leave that file
 * dependent on a live Zoho session to render — possibly blank months later.
 */
var QRImage = (function () {

  function looksLikeDataUri(s) {
    return typeof s === 'string' && s.indexOf('data:') === 0;
  }

  function looksLikeBase64(s) {
    return typeof s === 'string' && s.length > 64 && /^[A-Za-z0-9+/=\r\n]+$/.test(s);
  }

  /* PNG and JPEG both have recognisable base64 prefixes; default to PNG. */
  function mimeForBase64(b64) {
    if (b64.indexOf('/9j/') === 0) return 'image/jpeg';
    if (b64.indexOf('R0lGOD') === 0) return 'image/gif';
    return 'image/png';
  }

  function toDataUri(payload) {
    if (!payload) return null;
    if (looksLikeDataUri(payload)) return payload;
    if (looksLikeBase64(payload)) {
      var clean = payload.replace(/\s+/g, '');
      return 'data:' + mimeForBase64(clean) + ';base64,' + clean;
    }
    return null;
  }

  /*
   * Resolves { dataUri, remoteUrl, inlined, error }.
   *
   * `inlined` true means the QR bytes are embedded and the printed PDF is
   * portable. False with a remoteUrl means the copy would reference Zoho and
   * need a signed-in session to display the QR.
   *
   * The fetch goes through an API Configuration like every other Books call —
   * widgets cannot request arbitrary URLs, so the tokenised qr_link is passed
   * to a configuration that pins the QR endpoint.
   */
  function fetchQr(qrLink) {
    if (!qrLink) {
      return Promise.resolve({ dataUri: null, remoteUrl: null, inlined: false,
                               error: 'This invoice has no e-invoice QR on record.' });
    }

    if (typeof ZFClient === 'undefined' || typeof ZFClient.getEinvoiceQr !== 'function') {
      return Promise.resolve({ dataUri: null, remoteUrl: qrLink, inlined: false,
                               error: 'Extension client unavailable; linking the QR instead.' });
    }

    return ZFClient.getEinvoiceQr(qrLink).then(function (body) {
      if (body && typeof body === 'object') {
        body = body.data || body.content || body.base64 || body.body || null;
      }
      var dataUri = toDataUri(body);
      if (dataUri) return { dataUri: dataUri, remoteUrl: qrLink, inlined: true, error: null };
      return { dataUri: null, remoteUrl: qrLink, inlined: false,
               error: 'QR image could not be embedded; linking it instead.' };
    }).catch(function (e) {
      return { dataUri: null, remoteUrl: qrLink, inlined: false,
               error: 'QR image could not be embedded ('
                      + (e && e.message ? e.message : 'request failed') + '); linking it instead.' };
    });
  }

  return { fetchQr: fetchQr, _toDataUri: toDataUri };
})();
