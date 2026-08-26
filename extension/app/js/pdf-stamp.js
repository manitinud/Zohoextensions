/*
 * Stamps the e-invoice band onto the organization's OWN invoice PDF.
 *
 * The point of this module is what it does NOT do: it never redraws the
 * invoice. Every organization customises its Zoho Books invoice template, and
 * that template is the document the customer expects to receive. So the PDF is
 * fetched from Books exactly as Books renders it, and the band is added above
 * the existing artwork.
 *
 * Each page is rebuilt as: the original page embedded unchanged but scaled down
 * slightly and pushed to the bottom, with the freed strip at the top carrying
 * the e-invoice band. Scaling keeps the aspect ratio, so nothing in the client's
 * design distorts — it is the same page, marginally smaller, with a header
 * above it. Overlaying the band directly on the untouched page was rejected
 * because it would collide with letterheads and logos, which is exactly the
 * kind of surprise a client's branded template must not spring.
 */
var PDFStamp = (function () {

  var BAND_HEIGHT = 104;  // points of vertical space reserved on every page
  var MARGIN = 18;
  var QR_SIZE = 78;

  function lib() {
    if (typeof PDFLib === 'undefined') {
      throw new Error('PDF library failed to load.');
    }
    return PDFLib;
  }

  function base64ToBytes(b64) {
    var clean = String(b64).replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
    var bin = atob(clean);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /*
   * Wrap a long value across lines so a 64-character IRN fits the band instead
   * of running off the page.
   */
  function chunk(text, size) {
    var parts = [];
    for (var i = 0; i < text.length; i += size) parts.push(text.substr(i, size));
    return parts;
  }

  function drawBand(page, ctx, w, h, fonts, qrImage) {
    var PDFLibRef = lib();
    var rgb = PDFLibRef.rgb;
    var d = ctx.einvoice;
    var top = h - MARGIN;
    var bandTop = top;
    var bandBottom = h - BAND_HEIGHT + 4;

    page.drawRectangle({
      x: MARGIN, y: bandBottom, width: w - MARGIN * 2, height: bandTop - bandBottom,
      borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1, color: rgb(1, 1, 1)
    });

    var x = MARGIN + 10;
    var y = bandTop - 13;

    page.drawText('e-INVOICE', { x: x, y: y, size: 8.5, font: fonts.bold, color: rgb(0, 0, 0) });
    y -= 13;

    function field(label, value, valueSize) {
      if (!value) return;
      page.drawText(label, { x: x, y: y, size: 7, font: fonts.bold, color: rgb(0.25, 0.25, 0.25) });
      var lines = chunk(String(value), 46);
      for (var i = 0; i < lines.length; i++) {
        page.drawText(lines[i], {
          x: x + 52, y: y - i * 8.5, size: valueSize || 7, font: fonts.regular, color: rgb(0, 0, 0)
        });
      }
      y -= 9 + (lines.length - 1) * 8.5;
    }

    field('IRN', d.irn);
    field('Ack No.', d.ackNo);
    field('Ack Date', d.ackDate);
    if (ctx.showStatus !== false) field('Status', d.status);

    if (qrImage) {
      page.drawImage(qrImage, {
        x: w - MARGIN - 10 - QR_SIZE,
        y: bandBottom + (bandTop - bandBottom - QR_SIZE) / 2,
        width: QR_SIZE, height: QR_SIZE
      });
    }
  }

  /*
   * ctx = { pdfBytes, einvoice, qrPngBase64 }
   * Resolves a Uint8Array of the stamped PDF.
   */
  function stamp(ctx) {
    var PDFLibRef = lib();
    var PDFDocument = PDFLibRef.PDFDocument;
    var StandardFonts = PDFLibRef.StandardFonts;

    var srcBytes = ctx.pdfBytes;

    return PDFDocument.create().then(function (out) {
      return Promise.all([
        out.embedFont(StandardFonts.Helvetica),
        out.embedFont(StandardFonts.HelveticaBold),
        PDFDocument.load(srcBytes)
      ]).then(function (r) {
        var fonts = { regular: r[0], bold: r[1] };
        var original = r[2];
        var indices = original.getPages().map(function (_, i) { return i; });

        var qrPromise = ctx.qrPngBase64
          ? out.embedPng(base64ToBytes(ctx.qrPngBase64)).catch(function () { return null; })
          : Promise.resolve(null);

        return Promise.all([out.embedPdf(srcBytes, indices), qrPromise])
          .then(function (both) {
            var pages = both[0], qrImage = both[1];

            pages.forEach(function (ep) {
              var w = ep.width, h = ep.height;
              var page = out.addPage([w, h]);

              // Free BAND_HEIGHT at the top without distorting the artwork.
              var scale = (h - BAND_HEIGHT) / h;
              page.drawPage(ep, {
                x: (w - w * scale) / 2,
                y: 0,
                xScale: scale,
                yScale: scale
              });

              drawBand(page, ctx, w, h, fonts, qrImage);
            });

            return out.save();
          });
      });
    });
  }

  return {
    stamp: stamp,
    BAND_HEIGHT: BAND_HEIGHT,
    _chunk: chunk,
    _base64ToBytes: base64ToBytes
  };
})();
