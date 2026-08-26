/*
 * Renders a QR payload to a self-contained data URI.
 *
 * The print document is opened in a separate window and may be saved as PDF, so
 * the QR must not depend on anything external: it is drawn to a canvas and
 * inlined as a PNG data URI.
 *
 * Capacity note: a GST signed QR is a JWS, typically 800-1500 characters. At
 * error-correction level L a QR symbol holds 2953 bytes, so real payloads fit
 * with room to spare, but the ceiling is enforced here with a clear message
 * rather than letting the encoder throw an opaque error.
 */
var QR = (function () {
  var MAX_BYTES = 2953; // version 40, EC level L, byte mode

  function byteLength(s) {
    return unescape(encodeURIComponent(s)).length;
  }

  /*
   * Returns { dataUri, modules } or throws with a message fit to show a user.
   * `sizePx` is the target edge length; the module size is rounded to a whole
   * pixel so the symbol stays crisp, which matters for scanner reliability on
   * a printed page.
   */
  function toDataUri(text, sizePx, ecLevel) {
    if (!text) throw new Error('No QR payload.');
    var bytes = byteLength(text);
    if (bytes > MAX_BYTES) {
      throw new Error('QR payload is ' + bytes + ' bytes; the maximum a QR symbol can '
        + 'carry is ' + MAX_BYTES + '. The signed QR string appears to be corrupted '
        + 'or concatenated.');
    }

    var qr = qrcode(0, ecLevel || 'L'); // 0 = pick the smallest version that fits
    qr.addData(text, 'Byte');
    qr.make();

    var count = qr.getModuleCount();
    var quiet = 4; // the spec's mandatory quiet zone, in modules
    var target = sizePx || 150;

    /*
     * Oversample the raster relative to the CSS size the page will show it at.
     * A signed QR needs ~97-129 modules, so at 1 device pixel per module the
     * image would be smaller than its CSS box and the browser would upscale it
     * — soft edges, and scanners struggle. Rendering at >=3x and letting CSS
     * scale down means the printer gets whole, sharp modules at 300dpi+.
     */
    var scale = Math.max(3, Math.ceil((target * 3) / (count + quiet * 2)));
    var edge = (count + quiet * 2) * scale;

    var canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, edge, edge);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (!qr.isDark(r, c)) continue;
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return { dataUri: canvas.toDataURL('image/png'), modules: count, pixels: edge };
  }

  return { toDataUri: toDataUri, MAX_BYTES: MAX_BYTES, byteLength: byteLength };
})();
