/*
 * Gets the e-invoice QR into the print document.
 *
 * Zoho Books serves the QR as an image at `einvoice_details.qr_link`. That image
 * is the IRP's signed QR — the extension neither generates nor re-encodes it.
 *
 * The print document is opened in a separate window and is usually saved as a
 * PDF, so a remote <img src> is a poor default: the saved file would depend on
 * a live Zoho session to render, and could come out blank months later. The
 * preferred path is therefore to pull the bytes through the ZFAPPS proxy and
 * inline them as a data URI, leaving the printed copy self-contained.
 *
 * Direct browser fetching is not an option: qr_link is cross-origin to the
 * widget's iframe and Books sends no CORS headers for it, so fetch() would be
 * blocked. ZFAPPS.request goes server-side and is not subject to that.
 *
 * If the proxy path fails, the remote URL is used as a fallback and the caller
 * is told, so the widget can warn that the QR needs a live session to render.
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
   * `inlined` true means the QR is embedded and the printed PDF is portable.
   * `inlined` false with a remoteUrl means the document will reference Zoho and
   * needs a signed-in session to display the QR.
   */
  function fetchQr(qrLink) {
    if (!qrLink) {
      return Promise.resolve({ dataUri: null, remoteUrl: null, inlined: false,
                               error: 'This invoice has no e-invoice QR on record.' });
    }

    if (typeof ZFAPPS === 'undefined' || !ZFAPPS || typeof ZFAPPS.request !== 'function') {
      return Promise.resolve({ dataUri: null, remoteUrl: qrLink, inlined: false,
                               error: 'Extension SDK unavailable; linking the QR instead.' });
    }

    return ZFAPPS.request({
      url: qrLink,
      method: 'GET',
      // Ask the proxy for bytes rather than a parsed body. Books returns an
      // image; which of these hints the running SDK honours varies, so send
      // both and normalise whatever comes back.
      resp_type: 'base64',
      response_type: 'base64'
    }).then(function (res) {
      var body = res && (res.response !== undefined ? res.response : res.body);
      if (body && typeof body === 'object') {
        // Some SDK builds wrap the payload one level deeper.
        body = body.data || body.content || body.base64 || body.body || null;
      }
      var dataUri = toDataUri(body);
      if (dataUri) return { dataUri: dataUri, remoteUrl: qrLink, inlined: true, error: null };
      return { dataUri: null, remoteUrl: qrLink, inlined: false,
               error: 'QR image could not be embedded; linking it instead.' };
    }).catch(function (e) {
      return { dataUri: null, remoteUrl: qrLink, inlined: false,
               error: 'QR image could not be embedded (' + (e && e.message ? e.message : 'request failed')
                      + '); linking it instead.' };
    });
  }

  return { fetchQr: fetchQr, _toDataUri: toDataUri };
})();
