/*
 * Builds the printable e-invoice document.
 *
 * Why this exists at all: a Sigma extension cannot change how Zoho Books renders
 * its own invoice PDF. The Books template engine decides where the e-invoice
 * block and QR land, and it places them once per document. To get the e-invoice
 * band at the top of EVERY page, the extension has to own the layout — so this
 * module emits a complete, self-contained HTML document that the browser prints.
 *
 * The repeat-on-every-page mechanism is the <thead> of a table that spans the
 * whole document. Printing engines repeat thead rows at the top of each page
 * they break onto; this is far more dependable across Chrome/Edge/Firefox than
 * position:fixed, which several engines paint only on the first page.
 */
var PrintDoc = (function () {

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n, symbol) {
    var v = Number(n || 0);
    // Indian digit grouping (##,##,###.##)
    var fixed = Math.abs(v).toFixed(2);
    var parts = fixed.split('.');
    var whole = parts[0];
    var last3 = whole.slice(-3);
    var rest = whole.slice(0, -3);
    if (rest) last3 = ',' + last3;
    var grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3;
    return (v < 0 ? '-' : '') + (symbol || '') + grouped + '.' + parts[1];
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
    'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }

  function threeDigits(n) {
    var out = '';
    if (n >= 100) { out = ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) out += ' and '; }
    if (n) out += twoDigits(n);
    return out;
  }

  /* Indian numbering, because a GST invoice states the total in words. */
  function amountInWords(amount, currencyName) {
    var v = Math.round(Number(amount || 0) * 100) / 100;
    var rupees = Math.floor(v);
    var paise = Math.round((v - rupees) * 100);
    if (rupees === 0 && paise === 0) return 'Zero Only';

    var groups = [
      { div: 10000000, label: 'Crore' },
      { div: 100000, label: 'Lakh' },
      { div: 1000, label: 'Thousand' }
    ];
    var words = [];
    groups.forEach(function (g) {
      var q = Math.floor(rupees / g.div);
      if (q) { words.push(threeDigits(q) + ' ' + g.label); rupees %= g.div; }
    });
    if (rupees) words.push(threeDigits(rupees));

    var out = (currencyName ? currencyName + ' ' : '') + words.join(' ');
    if (paise) out += ' and ' + twoDigits(paise) + ' Paise';
    return out.trim() + ' Only';
  }

  function addressBlock(addr, name, gstin) {
    if (!addr) addr = {};
    var lines = [
      name,
      addr.attention,
      addr.address || addr.street,
      addr.street2,
      [addr.city, addr.state, addr.zip || addr.zipcode].filter(Boolean).join(', '),
      addr.country,
      gstin ? 'GSTIN: ' + gstin : '',
      addr.phone ? 'Ph: ' + addr.phone : ''
    ].filter(Boolean);
    return lines.map(function (l, i) {
      return '<div class="' + (i === 0 ? 'party-name' : 'party-line') + '">' + esc(l) + '</div>';
    }).join('');
  }

  /*
   * The e-invoice band. This markup goes inside <thead>, so whatever it contains
   * is what reappears at the top of every page.
   */
  function headerBand(ctx) {
    var d = ctx.einvoice, s = ctx.settings.header, org = ctx.org || {}, inv = ctx.invoice;
    var rows = [];

    if (s.showIrn && d.irn) {
      rows.push('<tr><th>IRN</th><td class="mono irn">' + esc(d.irn) + '</td></tr>');
    }
    if (s.showAck) {
      if (d.ackNo) rows.push('<tr><th>Ack No.</th><td class="mono">' + esc(d.ackNo) + '</td></tr>');
      if (d.ackDate) rows.push('<tr><th>Ack Date</th><td>' + esc(d.ackDate) + '</td></tr>');
    }
    if (s.showGstin) {
      var sellerGstin = org.gst_no || org.tax_reg_no || '';
      if (sellerGstin) {
        rows.push('<tr><th>Seller GSTIN</th><td class="mono">' + esc(sellerGstin) + '</td></tr>');
      }
      if (inv.gst_no) {
        rows.push('<tr><th>Buyer GSTIN</th><td class="mono">' + esc(inv.gst_no) + '</td></tr>');
      }
    }
    rows.push('<tr><th>Invoice No.</th><td class="mono">' + esc(inv.invoice_number) + '</td></tr>');
    rows.push('<tr><th>Invoice Date</th><td>' + esc(inv.date) + '</td></tr>');
    if (s.showStatus && d.status) {
      rows.push('<tr><th>e-Invoice</th><td>' + esc(d.status) + '</td></tr>');
    }

    /*
     * The QR is whatever Zoho Books issued for this e-invoice: inlined as a data
     * URI when the bytes could be fetched, otherwise referenced by Books' own
     * URL. Never synthesised - an e-invoice QR is an IRP signature.
     */
    var qrCell = '';
    if (s.showQr) {
      var qrSrc = ctx.qrDataUri || ctx.qrRemoteUrl;
      qrCell = qrSrc
        ? '<div class="qr-wrap"><img class="qr" alt="e-Invoice QR code" src="' + qrSrc + '">'
          + '<div class="qr-caption">e-Invoice QR</div></div>'
        : '<div class="qr-wrap qr-missing"><div class="qr-placeholder">QR unavailable</div>'
          + '<div class="qr-caption">' + esc(ctx.qrError || 'No e-invoice QR on record')
          + '</div></div>';
    }

    return ''
      + '<div class="einv-band">'
      +   '<div class="einv-title">' + esc(ctx.docTitle) + '</div>'
      +   '<div class="einv-body">'
      +     '<table class="einv-kv">' + rows.join('') + '</table>'
      +     qrCell
      +   '</div>'
      + '</div>';
  }

  function lineItemRows(inv) {
    return (inv.line_items || []).map(function (li, i) {
      var taxLabel = li.tax_percentage ? li.tax_percentage + '%'
        : (li.tax_exemption_code ? esc(li.tax_exemption_code) : '0%');
      return ''
        + '<tr>'
        +   '<td class="c">' + (i + 1) + '</td>'
        +   '<td>' + esc(li.name) + (li.description
              ? '<div class="item-desc">' + esc(li.description).replace(/\n/g, '<br>') + '</div>'
              : '') + '</td>'
        +   '<td class="c mono">' + esc(li.hsn_or_sac || '') + '</td>'
        +   '<td class="r">' + esc(li.quantity) + (li.unit ? ' ' + esc(li.unit) : '') + '</td>'
        +   '<td class="r">' + money(li.rate, '') + '</td>'
        +   '<td class="c">' + taxLabel + '</td>'
        +   '<td class="r">' + money(li.item_total, '') + '</td>'
        + '</tr>';
    }).join('');
  }

  function taxRows(inv) {
    var sym = inv.currency_symbol || '';
    return (inv.taxes || []).map(function (t) {
      return '<tr><th>' + esc(t.tax_name) + '</th><td class="r">' + money(t.tax_amount, sym) + '</td></tr>';
    }).join('');
  }

  function totalsBlock(inv) {
    var sym = inv.currency_symbol || '';
    var rows = ''
      + '<tr><th>Sub Total</th><td class="r">' + money(inv.sub_total, sym) + '</td></tr>'
      + (Number(inv.discount_total) ? '<tr><th>Discount</th><td class="r">-' + money(inv.discount_total, sym) + '</td></tr>' : '')
      + taxRows(inv)
      + (Number(inv.shipping_charge) ? '<tr><th>Shipping</th><td class="r">' + money(inv.shipping_charge, sym) + '</td></tr>' : '')
      + (Number(inv.adjustment) ? '<tr><th>' + esc(inv.adjustment_description || 'Adjustment') + '</th><td class="r">' + money(inv.adjustment, sym) + '</td></tr>' : '')
      + (Number(inv.roundoff_value) ? '<tr><th>Round Off</th><td class="r">' + money(inv.roundoff_value, sym) + '</td></tr>' : '')
      + '<tr class="grand"><th>Total</th><td class="r">' + money(inv.total, sym) + '</td></tr>'
      + (Number(inv.balance) !== Number(inv.total)
          ? '<tr><th>Balance Due</th><td class="r">' + money(inv.balance, sym) + '</td></tr>' : '');
    return '<table class="totals">' + rows + '</table>';
  }

  function styles(settings) {
    return ''
      + '@page { size: A4; margin: 10mm 10mm 14mm 10mm; }'
      + 'html,body{margin:0;padding:0;}'
      + 'body{font:11px/1.45 "Helvetica Neue",Arial,sans-serif;color:#1a1a1a;'
      +   '-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      + '.sheet{width:100%;border-collapse:collapse;}'
      /* thead repeats on every printed page - this is the whole point. */
      + '.sheet > thead{display:table-header-group;}'
      + '.sheet > tfoot{display:table-footer-group;}'
      + '.sheet > thead td,.sheet > tbody td,.sheet > tfoot td{padding:0;vertical-align:top;}'
      + '.einv-band{border:1.2px solid #111;border-radius:2px;padding:6px 8px;margin-bottom:8px;'
      +   'background:#fff;break-inside:avoid;page-break-inside:avoid;}'
      + '.einv-title{font-size:12.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;'
      +   'text-align:center;border-bottom:1px solid #111;padding-bottom:4px;margin-bottom:6px;}'
      + '.einv-body{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}'
      + '.einv-kv{border-collapse:collapse;flex:1 1 auto;}'
      + '.einv-kv th{text-align:left;font-weight:600;color:#444;padding:1px 8px 1px 0;'
      +   'white-space:nowrap;vertical-align:top;font-size:10px;}'
      + '.einv-kv td{padding:1px 0;font-size:10px;word-break:break-all;}'
      + '.einv-kv td.irn{font-size:9.5px;max-width:340px;}'
      + '.mono{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;}'
      + '.qr-wrap{flex:0 0 auto;text-align:center;}'
      + '.qr{display:block;width:' + (settings.qrSizePx || 150) + 'px;height:auto;image-rendering:pixelated;}'
      + '.qr-caption{font-size:8px;color:#555;margin-top:2px;}'
      + '.qr-missing .qr-placeholder{width:' + (settings.qrSizePx || 150) + 'px;height:'
      +   (settings.qrSizePx || 150) + 'px;border:1px dashed #b00;color:#b00;font-size:9px;'
      +   'display:flex;align-items:center;justify-content:center;text-align:center;}'
      + '.parties{display:flex;gap:10px;margin-bottom:8px;}'
      + '.party{flex:1;border:1px solid #ccc;padding:6px 8px;}'
      + '.party-label{font-size:8.5px;text-transform:uppercase;letter-spacing:.5px;color:#666;'
      +   'margin-bottom:3px;}'
      + '.party-name{font-weight:700;font-size:11.5px;}'
      + '.party-line{font-size:10px;color:#333;}'
      + '.meta{display:flex;gap:10px;margin-bottom:8px;font-size:10px;}'
      + '.meta div{border:1px solid #ccc;padding:4px 8px;}'
      + 'table.items{width:100%;border-collapse:collapse;margin-bottom:8px;}'
      + 'table.items th{background:#f0f0f0;border:1px solid #999;padding:4px 5px;font-size:9.5px;'
      +   'text-transform:uppercase;letter-spacing:.3px;}'
      + 'table.items td{border:1px solid #bbb;padding:4px 5px;font-size:10px;}'
      + 'table.items thead{display:table-header-group;}'
      + 'table.items tr{break-inside:avoid;page-break-inside:avoid;}'
      + '.item-desc{color:#555;font-size:9px;margin-top:1px;}'
      + '.c{text-align:center;} .r{text-align:right;white-space:nowrap;}'
      + '.foot{display:flex;gap:10px;align-items:flex-start;break-inside:avoid;}'
      + '.foot-left{flex:1;font-size:10px;}'
      + '.words{border:1px solid #ccc;padding:5px 7px;margin-bottom:6px;}'
      + '.words-label{font-size:8.5px;text-transform:uppercase;color:#666;}'
      + 'table.totals{border-collapse:collapse;min-width:210px;}'
      + 'table.totals th{text-align:left;font-weight:500;padding:2px 10px 2px 0;font-size:10px;}'
      + 'table.totals td{padding:2px 0;font-size:10px;}'
      + 'table.totals tr.grand th,table.totals tr.grand td{border-top:1px solid #111;'
      +   'border-bottom:1.5px solid #111;font-weight:700;font-size:11.5px;padding-top:3px;}'
      + '.notes{margin-top:8px;font-size:9.5px;color:#333;white-space:pre-wrap;}'
      + '.sign{margin-top:22px;text-align:right;font-size:10px;}'
      + '.pagefoot{font-size:8.5px;color:#666;text-align:center;padding-top:4px;'
      +   'border-top:1px solid #ddd;}'
      + '@media screen{body{background:#e9e9e9;padding:16px;}'
      +   '.sheet{background:#fff;max-width:210mm;margin:0 auto;padding:12mm;'
      +   'box-shadow:0 1px 6px rgba(0,0,0,.25);}}';
  }

  /*
   * ctx = { invoice, org, einvoice, qrDataUri, qrError, settings, docTitle }
   * Returns a complete HTML document string.
   */
  function build(ctx) {
    var inv = ctx.invoice;
    var org = ctx.org || {};
    var s = ctx.settings;
    var currencyName = inv.currency_code === 'INR' ? 'Rupees' : (inv.currency_code || '');

    var sellerGstin = org.gst_no || org.tax_reg_no || '';
    var body = ''
      + '<div class="parties">'
      +   '<div class="party"><div class="party-label">Sold By</div>'
      +     addressBlock(org.address || {}, org.name, sellerGstin) + '</div>'
      +   '<div class="party"><div class="party-label">Billed To</div>'
      +     addressBlock(inv.billing_address, inv.customer_name, inv.gst_no) + '</div>'
      +   '<div class="party"><div class="party-label">Shipped To</div>'
      +     addressBlock(inv.shipping_address, inv.customer_name, inv.shipping_gst_no) + '</div>'
      + '</div>'
      + '<div class="meta">'
      +   '<div><strong>Place of Supply:</strong> ' + esc(inv.place_of_supply || '-') + '</div>'
      +   '<div><strong>Due Date:</strong> ' + esc(inv.due_date || '-') + '</div>'
      +   (inv.reference_number
            ? '<div><strong>Ref:</strong> ' + esc(inv.reference_number) + '</div>' : '')
      +   '<div><strong>Reverse Charge:</strong> '
      +     (inv.is_reverse_charge_applied ? 'Yes' : 'No') + '</div>'
      + '</div>'
      + '<table class="items">'
      +   '<thead><tr>'
      +     '<th style="width:26px">#</th><th>Item &amp; Description</th>'
      +     '<th style="width:72px">HSN/SAC</th><th style="width:66px">Qty</th>'
      +     '<th style="width:74px">Rate</th><th style="width:48px">Tax</th>'
      +     '<th style="width:88px">Amount</th>'
      +   '</tr></thead>'
      +   '<tbody>' + lineItemRows(inv) + '</tbody>'
      + '</table>'
      + '<div class="foot">'
      +   '<div class="foot-left">'
      +     '<div class="words"><div class="words-label">Total in Words</div>'
      +       esc(amountInWords(inv.total, currencyName)) + '</div>'
      +     (inv.notes ? '<div class="notes">' + esc(inv.notes) + '</div>' : '')
      +     (inv.terms ? '<div class="notes"><strong>Terms:</strong> ' + esc(inv.terms) + '</div>' : '')
      +   '</div>'
      +   '<div>' + totalsBlock(inv)
      +     '<div class="sign">For ' + esc(org.name || '') + '<br><br><br>'
      +       'Authorised Signatory</div>'
      +   '</div>'
      + '</div>';

    var footer = s.header.showPageNumbers
      ? '<div class="pagefoot">' + esc(inv.invoice_number)
        + (ctx.einvoice.irn ? ' &middot; IRN ' + esc(ctx.einvoice.irn.slice(0, 16)) + '&hellip;' : '')
        + ' &middot; Computer generated e-Invoice</div>'
      : '';

    return '<!doctype html><html><head><meta charset="utf-8">'
      + '<title>' + esc(inv.invoice_number) + ' - e-Invoice</title>'
      + '<style>' + styles(s) + '</style></head><body>'
      + '<table class="sheet">'
      +   '<thead><tr><td>' + headerBand(ctx) + '</td></tr></thead>'
      +   '<tbody><tr><td>' + body + '</td></tr></tbody>'
      +   (footer ? '<tfoot><tr><td>' + footer + '</td></tr></tfoot>' : '')
      + '</table>'
      + '</body></html>';
  }

  return {
    build: build,
    _amountInWords: amountInWords,
    _money: money
  };
})();
