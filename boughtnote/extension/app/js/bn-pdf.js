/*
 * Draws the Bought Note PDF with pdf-lib: A4 landscape, two identical copies
 * side by side (Original | Duplicate), matching the organization's existing
 * printed format:
 *
 *   GST: <gstin>            <COMPANY NAME>            BOUGHT NOTE
 *   Bill No / Bill Date, Supplier / Address / PAN
 *   Sl.No  Variety  Count  Qty in KGs  Rate In Rs  Amt In Rs
 *   Total, Less TDS @ x %, Amount Payable After TDS, Amount in Words
 *   Supplier Signature   Checked By   Authorized Sign
 *
 * Long bills paginate: line rows repeat with the header on every page, the
 * totals block prints on the last page only.
 */
var BNPdf = (function () {

  var PAGE_W = 841.89, PAGE_H = 595.28;   // A4 landscape, points
  var COPY_W = PAGE_W / 2;
  var MARGIN = 14;
  var ROWS_PER_PAGE = 12;

  function fmt(n, dp) { return Number(n || 0).toFixed(dp); }

  function wrap(text, max) {
    var words = String(text || '').split(/\s+/);
    var lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (next.length > max && cur) { lines.push(cur); cur = w; }
      else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function drawCopy(doc, page, fonts, note, x0, label, rows, firstPage, lastPage) {
    var rgb = PDFLib.rgb;
    var black = rgb(0, 0, 0);
    var f = fonts.regular, fb = fonts.bold;
    var left = x0 + MARGIN;
    var right = x0 + COPY_W - MARGIN;
    var w = right - left;
    var y = PAGE_H - MARGIN - 4;

    function text(s, x, size, font, opts) {
      page.drawText(String(s), Object.assign(
        { x: x, y: y, size: size, font: font || f, color: black }, opts || {}));
    }
    function rightText(s, xRight, size, font) {
      var width = (font || f).widthOfTextAtSize(String(s), size);
      page.drawText(String(s), { x: xRight - width, y: y, size: size,
                                 font: font || f, color: black });
    }
    function centerText(s, size, font) {
      var width = (font || f).widthOfTextAtSize(String(s), size);
      page.drawText(String(s), { x: x0 + (COPY_W - width) / 2, y: y, size: size,
                                 font: font || f, color: black });
    }
    function hline(yy) {
      page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy },
                      thickness: 0.6, color: black });
    }

    // Outer border of the copy.
    page.drawRectangle({ x: x0 + 6, y: 6, width: COPY_W - 12, height: PAGE_H - 12,
                         borderWidth: 0.8, borderColor: black });

    centerText(label, 9, f); y -= 14;
    text('GST: ' + (note.company.gstin || '-'), left, 9, fb); y -= 16;
    centerText(note.company.name, 13, fb); y -= 16;
    centerText('BOUGHT NOTE', 11, fb); y -= 16;

    text('Bill No: ' + note.billNo, left, 9, fb);
    rightText('Bill Date: ' + note.billDate, right, 9, fb); y -= 12;
    text('Supplier: ' + note.supplier, left, 9, f); y -= 12;
    wrap('Address: ' + (note.address || '-'), 58).forEach(function (l) {
      text(l, left, 9, f); y -= 11;
    });
    text('PAN: ' + (note.pan || '-'), left, 9, f); y -= 14;

    // Table columns, as offsets within the copy.
    var C = {
      sl: left,
      variety: left + 26,
      countR: left + 0.44 * w,
      qtyR: left + 0.62 * w,
      rateR: left + 0.78 * w,
      amtR: right
    };
    hline(y + 9);
    text('Sl.No', C.sl, 8.5, fb);
    text('Variety', C.variety, 8.5, fb);
    rightText('Count', C.countR, 8.5, fb);
    rightText('Qty in KGs', C.qtyR, 8.5, fb);
    rightText('Rate In Rs', C.rateR, 8.5, fb);
    rightText('Amt In Rs', C.amtR, 8.5, fb);
    y -= 5; hline(y + 1); y -= 11;

    rows.forEach(function (l) {
      text(l.slNo, C.sl + 4, 9, f);
      text(l.variety.slice(0, 22), C.variety, 9, f);
      rightText(l.count ? fmt(l.count, 2) : '-', C.countR, 9, f);
      rightText(fmt(l.qty, 3), C.qtyR, 9, f);
      rightText(fmt(l.rate, 2), C.rateR, 9, f);
      rightText(fmt(l.amount, 2), C.amtR, 9, f);
      y -= 13;
    });

    if (!lastPage) {
      y -= 2;
      text('Continued on the next page…', left, 8.5, f);
    } else {
      hline(y + 9);
      text('Total', C.variety, 9, fb);
      rightText(fmt(note.totalQty, 3), C.qtyR, 9, fb);
      rightText(fmt(note.total, 2), C.amtR, 9, fb);
      y -= 13;
      text('Less TDS @ ' + Number(note.tdsPercent) + ' %', C.variety, 9, f);
      rightText(fmt(note.tdsAmount, 2), C.amtR, 9, f);
      y -= 13;
      text('Amount Payable After TDS', C.variety, 9, fb);
      rightText(fmt(note.payable, 2), C.amtR, 9, fb);
      y -= 15;
      text('Amount in Words', left, 9, fb); y -= 11;
      wrap(note.amountWords, 60).forEach(function (l) {
        text(l, left, 8.5, f); y -= 10;
      });
    }

    // Signature band, pinned to the bottom of the copy.
    var sy = 28;
    page.drawLine({ start: { x: left, y: sy + 14 }, end: { x: right, y: sy + 14 },
                    thickness: 0.6, color: black });
    page.drawText('Supplier Signature', { x: left, y: sy, size: 8.5, font: f, color: black });
    var cb = 'Checked By';
    page.drawText(cb, { x: x0 + (COPY_W - f.widthOfTextAtSize(cb, 8.5)) / 2,
                        y: sy, size: 8.5, font: f, color: black });
    var as = 'Authorized Sign';
    page.drawText(as, { x: right - f.widthOfTextAtSize(as, 8.5),
                        y: sy, size: 8.5, font: f, color: black });
  }

  function render(note) {
    return PDFLib.PDFDocument.create().then(function (doc) {
      return Promise.all([
        doc.embedFont(PDFLib.StandardFonts.Helvetica),
        doc.embedFont(PDFLib.StandardFonts.HelveticaBold)
      ]).then(function (fs) {
        var fonts = { regular: fs[0], bold: fs[1] };
        var pages = [];
        for (var i = 0; i < note.lines.length || i === 0; i += ROWS_PER_PAGE) {
          pages.push(note.lines.slice(i, i + ROWS_PER_PAGE));
        }
        pages.forEach(function (rows, pi) {
          var page = doc.addPage([PAGE_W, PAGE_H]);
          // Divider between the two copies.
          page.drawLine({ start: { x: COPY_W, y: 6 }, end: { x: COPY_W, y: PAGE_H - 6 },
                          thickness: 0.5, color: PDFLib.rgb(0.4, 0.4, 0.4),
                          dashArray: [3, 3] });
          var firstPage = pi === 0, lastPage = pi === pages.length - 1;
          drawCopy(doc, page, fonts, note, 0, 'Original', rows, firstPage, lastPage);
          drawCopy(doc, page, fonts, note, COPY_W, 'Duplicate', rows, firstPage, lastPage);
        });
        return doc.save();
      });
    });
  }

  return { render: render, _wrap: wrap, _fmt: fmt, ROWS_PER_PAGE: ROWS_PER_PAGE };
})();
