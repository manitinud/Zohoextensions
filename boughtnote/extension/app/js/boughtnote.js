/*
 * Maps a Zoho Books bill (plus its vendor contact and the organization) onto
 * the Bought Note model, exactly as the note prints:
 *
 *   Bill No / Bill Date / Supplier / Address / PAN
 *   lines: Sl.No | Variety | Count | Qty in KGs | Rate | Amount
 *   Total, Less TDS @ x %, Amount Payable After TDS, Amount in Words
 *
 * Everything is read; nothing is computed that Books already holds. The one
 * derivation is Count: the cf_count line custom field when present, else
 * parsed from the line description — the organization's long-standing
 * convention is "103 C" / "106.5 C" there, and old bills must still print.
 */
var BoughtNote = (function () {

  /*
   * Internal extension for one organization: when the widget's host context
   * does not hand over the organization name/GSTIN (seen live), these
   * verified values print instead. Update here if the company ever changes.
   */
  var DEFAULT_COMPANY = {
    name: 'Adivishnu Marine Foods Pvt Ltd',
    gstin: '37AAXCA3167E1ZC'
  };

  // Books stores dates as yyyy-mm-dd; the note prints dd-mm-yyyy.
  function formatDate(d) {
    var m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(d || ''));
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(d || '');
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /* Count for one line: the cf_count line custom field, and ONLY that — the
   * organization decided counts are entered in the Count column, so nothing
   * is inferred from free-text descriptions. No count entered prints blank. */
  function lineCount(li) {
    var cfs = li.item_custom_fields || li.custom_fields || [];
    for (var i = 0; i < cfs.length; i++) {
      var cf = cfs[i];
      if ((cf.api_name === 'cf_count' || cf.placeholder === 'cf_count'
           || /^count$/i.test(cf.label || ''))
          && cf.value !== undefined && cf.value !== null && cf.value !== '') {
        return String(cf.value);
      }
    }
    if (li.cf_count !== undefined && li.cf_count !== null && li.cf_count !== '') {
      return String(li.cf_count);
    }
    return '';
  }

  function joinAddress(a) {
    if (!a) return '';
    return [a.attention, a.address, a.street2, a.city, a.state, a.zip]
      .filter(function (p) { return p && String(p).trim(); })
      .join(', ');
  }

  /*
   * Amount in words, Indian numbering (crore / lakh / thousand), matching the
   * reference note: "NINE LAKH EIGHTY FIVE THOUSAND TWO HUNDRED AND EIGHTY
   * RUPEES" — uppercase, AND only inside the final hundreds group, paise
   * appended when present.
   */
  var ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT',
    'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN',
    'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  var TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY',
    'EIGHTY', 'NINETY'];

  function twoDigits(n) {
    if (n < 20) return ONES[n];
    var t = TENS[Math.floor(n / 10)];
    return n % 10 ? t + ' ' + ONES[n % 10] : t;
  }

  function threeDigits(n) {
    var h = Math.floor(n / 100), r = n % 100;
    if (h && r) return ONES[h] + ' HUNDRED AND ' + twoDigits(r);
    if (h) return ONES[h] + ' HUNDRED';
    return twoDigits(r);
  }

  function integerWords(n) {
    if (n === 0) return 'ZERO';
    var parts = [];
    var crore = Math.floor(n / 10000000); n %= 10000000;
    var lakh = Math.floor(n / 100000); n %= 100000;
    var thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) parts.push(integerWords(crore) + ' CRORE');
    if (lakh) parts.push(twoDigits(lakh) + ' LAKH');
    if (thousand) parts.push(twoDigits(thousand) + ' THOUSAND');
    if (n) parts.push(threeDigits(n));
    return parts.join(' ');
  }

  function amountInWords(amount) {
    var rupees = Math.floor(num(amount));
    var paise = Math.round((num(amount) - rupees) * 100);
    var out = integerWords(rupees) + ' RUPEES';
    if (paise) out += ' AND ' + twoDigits(paise) + ' PAISE';
    return out;
  }

  /*
   * TDS on the bill: Books stores tds_percent / tds_amount at bill level (or
   * per line, summed in tds_summary). The note prints the rate and the amount;
   * a bill with no TDS prints the standard 0.1 % line with 0.00, exactly like
   * the reference note.
   */
  function tdsOf(bill) {
    var amount = num(bill.tds_amount);
    if (!amount && bill.tds_summary && bill.tds_summary.length) {
      bill.tds_summary.forEach(function (t) { amount += num(t.tds_amount || t.amount); });
    }
    var percent = num(bill.tds_percent);
    if (!percent && bill.tds_summary && bill.tds_summary.length) {
      percent = num(bill.tds_summary[0].tds_percentage || bill.tds_summary[0].percentage);
    }
    if (!percent) percent = 0.1;
    return { percent: percent, amount: amount };
  }

  function build(bill, vendor, org) {
    bill = bill || {};
    var lines = (bill.line_items || []).map(function (li, i) {
      return {
        slNo: i + 1,
        variety: li.name || '',
        count: lineCount(li),
        qty: num(li.quantity),
        rate: num(li.rate),
        amount: num(li.item_total)
      };
    });
    var totalQty = 0, totalAmount = 0;
    lines.forEach(function (l) { totalQty += l.qty; totalAmount += l.amount; });

    var tds = tdsOf(bill);
    /*
     * Books' bill total is ALREADY net of TDS (sub_total - TDS + adjustment),
     * proven against a live bill: sub_total 14,41,829.80, TDS 1,442.00,
     * adjustment 0.20 -> total 14,40,388.00. The note's Total row is the
     * GROSS, so it is reconstructed as payable + TDS; subtracting TDS from
     * bill.total again double-deducted it.
     */
    var payable = num(bill.total) || (totalAmount - tds.amount);
    var total = payable + tds.amount;

    var vaddr = joinAddress((vendor && vendor.billing_address) || bill.billing_address);

    return {
      company: {
        name: (org && org.name) || DEFAULT_COMPANY.name,
        gstin: (org && (org.gst_no || org.tax_reg_no
                || (org.tax_settings && org.tax_settings.tax_reg_no)))
               || DEFAULT_COMPANY.gstin
      },
      billNo: bill.bill_number || '',
      billDate: formatDate(bill.date),
      supplier: bill.vendor_name || (vendor && vendor.contact_name) || '',
      address: vaddr,
      pan: (vendor && vendor.pan_no) || '',
      lines: lines,
      totalQty: totalQty,
      total: total,
      tdsPercent: tds.percent,
      tdsAmount: tds.amount,
      payable: payable,
      amountWords: amountInWords(payable)
    };
  }

  function isEmpty(note) {
    return !note || !note.lines || note.lines.length === 0;
  }

  return { build: build, isEmpty: isEmpty,
           _amountInWords: amountInWords, _lineCount: lineCount,
           _integerWords: integerWords, _formatDate: formatDate };
})();
