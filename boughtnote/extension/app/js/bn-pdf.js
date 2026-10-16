/*
 * Draws the Bought Note PDF with pdf-lib: A4 landscape, two identical copies
 * side by side (Original | Duplicate), replicating the organization's
 * existing printed format cell for cell:
 *
 *   [ Original ]  <- banner row inside the outer border
 *   GST: <gstin>   (logo)  <COMPANY NAME>  /  BOUGHT NOTE
 *   Bill No ... Bill Date / Supplier / Address / PAN
 *   boxed grid: Sl.No | Variety | Count | Qty in KGs | Rate In Rs | Amt In Rs
 *   fixed-height item area, then Total / Less TDS / Amount Payable After TDS
 *   Amount in Words row, and three tall signature cells.
 *
 * The note block occupies the upper part of the page with the bottom left
 * blank, exactly like the reference. Long bills paginate; the totals and
 * signature section print on every page's grid the way the reference does,
 * with amounts only on the last page.
 */
var BNPdf = (function () {

  var PAGE_W = 841.89, PAGE_H = 595.28;   // A4 landscape, points
  var COPY_W = PAGE_W / 2;
  var ROWS_PER_PAGE = 10;

  // The note's palette: the organization's deep blue with a light tint for
  // the totals band. Amount figures stay black for photocopy legibility.
  function BLUE() { return PDFLib.rgb(0.078, 0.314, 0.49); }     // #14507d
  function TINT() { return PDFLib.rgb(0.914, 0.937, 0.957); }    // #e9eff4

  // Column widths as fractions of the grid width.
  var COLS = [0.08, 0.24, 0.10, 0.18, 0.17, 0.23]; // Sl, Variety, Count, Qty, Rate, Amt

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

  function drawCopy(page, fonts, note, x0, label, rows, lastPage, logo) {
    var rgb = PDFLib.rgb;
    var black = rgb(0, 0, 0);
    var f = fonts.regular, fb = fonts.bold;

    var outerL = x0 + 10, outerR = x0 + COPY_W - 10;
    var top = PAGE_H - 22;

    var blue = BLUE(), tint = TINT();
    function text(s, x, y, size, font, color) {
      page.drawText(String(s), { x: x, y: y, size: size, font: font || f,
                                 color: color || black });
    }
    function rightText(s, xRight, y, size, font, color) {
      var wdt = (font || f).widthOfTextAtSize(String(s), size);
      text(s, xRight - wdt, y, size, font, color);
    }
    function centerText(s, cx, y, size, font, color) {
      var wdt = (font || f).widthOfTextAtSize(String(s), size);
      text(s, cx - wdt / 2, y, size, font, color);
    }
    function box(x, y, w, h, thickness, fill) {
      page.drawRectangle({ x: x, y: y, width: w, height: h,
                           borderWidth: thickness || 0.9, borderColor: blue,
                           color: fill || undefined });
    }
    function vline(x, y1, y2) {
      page.drawLine({ start: { x: x, y: y1 }, end: { x: x, y: y2 },
                      thickness: 0.9, color: blue });
    }

    var white = rgb(1, 1, 1);
    var copyCx = x0 + COPY_W / 2;

    // ---- banner row: Original / Duplicate ----
    var bannerH = 17;
    var y = top - bannerH;
    box(outerL, y, outerR - outerL, bannerH, 1.2, blue);
    centerText(label, copyCx, y + 5, 11, fb, white);

    // ---- header block (inside the outer border, no inner boxes) ----
    y -= 17;
    text('GST: ' + (note.company.gstin || '-'), outerL + 8, y, 12, fb, blue);
    if (logo) {
      var lw = 42, lh = 42 * (logo.height / logo.width);
      if (lh > 42) { lh = 42; lw = 42 * (logo.width / logo.height); }
      page.drawImage(logo.img, { x: outerL + 10, y: y - 50, width: lw, height: lh });
    }
    y -= 26;
    centerText(note.company.name, copyCx, y, 18, fb, blue);
    y -= 26;
    centerText('BOUGHT NOTE', copyCx, y, 13.5, fb, blue);
    y -= 19;
    text('Bill No: ' + note.billNo, outerL + 8, y, 11.5, f);
    rightText('Bill Date: ' + note.billDate, outerR - 8, y, 11.5, f);
    y -= 16;
    text('Supplier: ' + note.supplier, outerL + 8, y, 11.5, f);
    y -= 16;
    var addr = wrap('Address: ' + (note.address || '-'), 52);
    addr.forEach(function (l) { text(l, outerL + 8, y, 11.5, f); y -= 15; });
    text('PAN: ' + (note.pan || '-'), outerL + 8, y, 11.5, f);
    y -= 7;

    // ---- the grid ----
    var gl = outerL + 4, gr = outerR - 4, gw = gr - gl;
    var xs = [gl];
    COLS.forEach(function (c) { xs.push(xs[xs.length - 1] + c * gw); });
    xs[xs.length - 1] = gr;

    var headH = 16, rowH = 15;
    var itemAreaH = Math.max(rows.length, ROWS_PER_PAGE) * rowH + 6;

    // header row: dark blue band with white labels
    y -= headH;
    box(gl, y, gw, headH, 1.1, blue);
    var HEAD = ['Sl.No', 'Variety', 'Count', 'Qty in KGs', 'Rate In Rs', 'Amt In Rs'];
    HEAD.forEach(function (h, idx) {
      text(h, xs[idx] + 3, y + 4.5, 10.5, fb, white);
    });

    // item area: one tall box with the column verticals running through it
    var itemTop = y;
    y -= itemAreaH;
    box(gl, y, gw, itemAreaH, 1.1);
    for (var j = 1; j < xs.length - 1; j++) vline(xs[j], y, itemTop);
    var ry = itemTop - rowH + 3;
    rows.forEach(function (l) {
      centerText(String(l.slNo), (xs[0] + xs[1]) / 2, ry, 11, f);
      text(String(l.variety).slice(0, 24), xs[1] + 4, ry, 11, f);
      rightText(l.count ? fmt(l.count, 2) : '', xs[3] - 4, ry, 11, f);
      rightText(fmt(l.qty, 3), xs[4] - 4, ry, 11, f);
      rightText(fmt(l.rate, 2), xs[5] - 4, ry, 11, f);
      rightText(fmt(l.amount, 2), xs[6] - 4, ry, 11, f);
      ry -= rowH;
    });
    if (!lastPage) {
      text('Continued…', xs[1] + 4, y + 5, 9.5, f);
    }

    // totals rows: label spans Sl+Variety+Count; qty, rate, amt cells keep
    // their verticals, exactly like the reference.
    function totalsRow(h, drawCells) {
      y -= h;
      box(gl, y, gw, h, 1.1, tint);
      [xs[3], xs[4], xs[5]].forEach(function (x) { vline(x, y, y + h); });
      drawCells(y, h);
    }

    totalsRow(16, function (yy) {
      centerText('Total', (gl + xs[3]) / 2, yy + 4.5, 11.5, fb);
      if (lastPage) {
        rightText(fmt(note.totalQty, 3), xs[4] - 4, yy + 4.5, 11.5, fb);
        rightText(fmt(note.total, 2), xs[6] - 4, yy + 4.5, 11.5, fb);
      }
    });
    totalsRow(16, function (yy) {
      centerText('Less TDS @ ' + Number(note.tdsPercent) + ' %',
                 (gl + xs[3]) / 2, yy + 4.5, 11.5, f);
      if (lastPage) rightText(fmt(note.tdsAmount, 2), xs[6] - 4, yy + 4.5, 11.5, f);
    });
    totalsRow(28, function (yy, h) {
      centerText('Amount Payable After', (gl + xs[3]) / 2, yy + 16, 11.5, f);
      centerText('TDS', (gl + xs[3]) / 2, yy + 4, 11.5, f);
      if (lastPage) rightText(fmt(note.payable, 2), xs[6] - 4, yy + 10, 11.5, f);
    });

    // amount in words: label cell + words cell spanning the rest, wrapped by
    // MEASURED width so long amounts never cross the cell border
    function wrapToWidth(s, font, size, maxW) {
      var words = String(s || '').split(/\s+/);
      var lines = [], cur = '';
      words.forEach(function (wd) {
        var next = cur ? cur + ' ' + wd : wd;
        if (font.widthOfTextAtSize(next, size) > maxW && cur) { lines.push(cur); cur = wd; }
        else cur = next;
      });
      if (cur) lines.push(cur);
      return lines;
    }
    var wordsCellW = (gr - xs[3]) - 12;
    var wordsLines = lastPage ? wrapToWidth(note.amountWords, f, 10, wordsCellW) : [''];
    var wordsH = Math.max(26, wordsLines.length * 12 + 10);
    y -= wordsH;
    box(gl, y, gw, wordsH, 1.1);
    vline(xs[3], y, y + wordsH);
    centerText('Amount in Words', (gl + xs[3]) / 2, y + wordsH / 2 - 4, 11.5, f);
    if (lastPage) {
      var wy = y + wordsH - 14;
      var wcx = (xs[3] + gr) / 2;
      wordsLines.forEach(function (l) { centerText(l, wcx, wy, 10, f); wy -= 12; });
    }

    // signature cells: three tall boxes, labels near the bottom
    var sigH = 46;
    y -= sigH;
    var sx = [gl, gl + gw * 0.30, gl + gw * 0.65, gr];
    box(gl, y, gw, sigH, 1.1);
    vline(sx[1], y, y + sigH);
    vline(sx[2], y, y + sigH);
    centerText('Supplier', (sx[0] + sx[1]) / 2, y + 16, 11.5, f);
    centerText('Signature', (sx[0] + sx[1]) / 2, y + 4, 11.5, f);
    centerText('Checked By', (sx[1] + sx[2]) / 2, y + 10, 11.5, f);
    centerText('Authorized Sign', (sx[2] + sx[3]) / 2, y + 10, 11.5, f);

    // outer border wrapping everything
    box(outerL, y - 4, outerR - outerL, top - (y - 4), 1.4);
  }

  function render(note, logoBytes) {
    return PDFLib.PDFDocument.create().then(function (doc) {
      return Promise.all([
        doc.embedFont(PDFLib.StandardFonts.Helvetica),
        doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
        logoBytes ? doc.embedPng(logoBytes).catch(function () { return null; })
                  : Promise.resolve(null)
      ]).then(function (fs) {
        var fonts = { regular: fs[0], bold: fs[1] };
        var logoImg = fs[2];
        var logo = logoImg
          ? { img: logoImg, width: logoImg.width, height: logoImg.height }
          : null;
        var pages = [];
        for (var i = 0; i < note.lines.length || i === 0; i += ROWS_PER_PAGE) {
          pages.push(note.lines.slice(i, i + ROWS_PER_PAGE));
        }
        pages.forEach(function (rows, pi) {
          var page = doc.addPage([PAGE_W, PAGE_H]);
          var lastPage = pi === pages.length - 1;
          drawCopy(page, fonts, note, 0, 'Original', rows, lastPage, logo);
          drawCopy(page, fonts, note, COPY_W, 'Duplicate', rows, lastPage, logo);
        });
        return doc.save();
      });
    });
  }

  return { render: render, _wrap: wrap, _fmt: fmt, ROWS_PER_PAGE: ROWS_PER_PAGE };
})();
