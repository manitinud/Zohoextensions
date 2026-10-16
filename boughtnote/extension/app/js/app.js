/*
 * Bill-detail widget controller for the Bought Note.
 *
 * Flow, with no configuration anywhere in it: take the bill in context, read
 * its full record (and the vendor, for PAN and address) through the API
 * configurations, build the Bought Note PDF — Original and Duplicate copies —
 * and open it to print.
 */
(function () {

  var BUILD = 'bn-v1';

  var state = { bill: null, org: null, vendor: null, note: null };

  var diag = { lines: [] };
  function note(label, value) {
    diag.lines.push([label, value]);
    try { renderDiagnostics(); } catch (e) { /* keep collecting */ }
    try { fit(); } catch (e) { /* resize is cosmetic */ }
  }

  function probeSdk() {
    note('build', BUILD);
    note('SDK script', window.__sdkUrl || 'unknown');
    if (typeof ZFAPPS === 'undefined' || !ZFAPPS) { note('ZFAPPS', 'NOT PRESENT'); return; }
    var keys = [];
    for (var k in ZFAPPS) { keys.push(k); }
    note('ZFAPPS keys', keys.sort().join(', ') || '(none enumerable)');
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(kind, text) {
    var el = $('status');
    el.className = 'status status--' + kind;
    el.textContent = text;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function row(label, valueHtml, mono) {
    return '<div class="kv"><span class="kv-k">' + label + '</span>'
      + '<span class="kv-v' + (mono ? ' mono' : '') + '">' + valueHtml + '</span></div>';
  }

  function missing() { return '<em class="muted">not recorded</em>'; }

  function renderDetails() {
    var n = state.note;
    if (!n) { $('details').innerHTML = ''; return; }
    $('details').innerHTML =
        row('Supplier', n.supplier ? esc(n.supplier) : missing())
      + row('PAN', n.pan ? esc(n.pan) : missing(), !!n.pan)
      + row('Lines', String(n.lines.length))
      + row('Total Qty (KGs)', n.totalQty.toFixed(3))
      + row('Total', n.total.toFixed(2))
      + row('TDS @ ' + Number(n.tdsPercent) + ' %', n.tdsAmount.toFixed(2))
      + row('Payable', n.payable.toFixed(2));
  }

  function openPrint() {
    if (!state.note || BoughtNote.isEmpty(state.note)) {
      setStatus('warn', 'Nothing to print - this bill has no line items.');
      return;
    }
    setStatus('info', 'Building the Bought Note…');
    $('print-btn').disabled = true;

    // Company logo for the note header: a bundled app/img/company-logo.png
    // wins (always works offline in the saved PDF); none bundled -> no logo.
    var logoP = fetch('img/company-logo.png')
      .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
      .catch(function () { return null; });

    logoP
      .then(function (logoBytes) {
        return BNPdf.render(state.note, logoBytes ? new Uint8Array(logoBytes) : null);
      })
      .then(function (bytes) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        var url = URL.createObjectURL(blob);
        var w = window.open(url, '_blank');
        if (!w) {
          setStatus('warn', 'Your browser blocked the new window. Allow pop-ups for Zoho Books, '
            + 'then try again.');
        } else {
          setStatus('ok', 'Bought Note ready. Print or save it from the new tab.');
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        $('print-btn').disabled = false;
      })
      .catch(function (err) {
        setStatus('error', 'Could not build the Bought Note: ' + (err.message || err));
        $('print-btn').disabled = false;
      });
  }

  function diagText() {
    return diag.lines.map(function (l) { return l[0] + ': ' + l[1]; }).join('\n');
  }

  function renderDiagnostics() {
    var el = $('diag');
    if (!el || !diag.lines.length) return;
    el.innerHTML =
        '<details><summary>Diagnostics</summary>'
      + '<textarea id="diag-text" class="diag-text" readonly rows="12"></textarea>'
      + '<button type="button" class="btn diag-copy" id="diag-copy">Copy diagnostics</button>'
      + '</details>';
    $('diag-text').value = diagText();
    $('diag-copy').addEventListener('click', function () {
      var t = $('diag-text');
      t.select();
      try { document.execCommand('copy'); this.textContent = 'Copied'; }
      catch (e) { this.textContent = 'Select the text above and copy'; }
    });
  }

  function fit() { ZFClient.resize(document.body.scrollHeight + 16); }

  function outline(body) {
    try {
      if (body === null || body === undefined) return String(body);
      if (typeof body === 'string') return 'string[' + body.length + ']: ' + body.slice(0, 200);
      return JSON.stringify(body).slice(0, 600);
    } catch (e) { return 'unserialisable'; }
  }

  function digBill(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.bill && typeof body.bill === 'object') return body.bill;
    if (body.bill_id) return body;
    return null;
  }

  function digContact(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.contact && typeof body.contact === 'object') return body.contact;
    if (body.contact_id) return body;
    return null;
  }

  function load() {
    setStatus('info', 'Reading the bill from Zoho Books…');
    $('print-btn').disabled = true;

    return Promise.all([ZFClient.getBillContext(), ZFClient.getOrganization()])
      .then(function (res) {
        state.bill = res[0];
        state.org = res[1];
        if (!state.bill || !state.bill.bill_id) throw new Error('No bill in context.');
        $('bill-no').textContent = state.bill.bill_number || '';
        note('bill keys returned', Object.keys(state.bill).length);
        note('API config (bill)', ZFClient.API.bill);
        note('API config (vendor)', ZFClient.API.vendor);

        // The context bill is often abridged; the API record is authoritative.
        return ZFClient.getBill(state.bill.bill_id).then(function (body) {
          note('bill body', outline(body));
          var full = digBill(body);
          if (full) state.bill = full;
          return null;
        }).catch(function (e) {
          note('bill API error', e.message || String(e));
          state.lookupError = e.message || String(e);
          return null;
        });
      })
      .then(function () {
        var vid = state.bill.vendor_id || state.bill.contact_id;
        if (!vid || typeof ZFClient.getVendor !== 'function') return null;
        return ZFClient.getVendor(vid).then(function (body) {
          note('vendor body', outline(body));
          state.vendor = digContact(body);
          return null;
        }).catch(function (e) {
          note('vendor API error', e.message || String(e));
          return null;
        });
      })
      .then(function () {
        state.note = BoughtNote.build(state.bill, state.vendor, state.org);
        var log = ZFClient._shapeLog();
        if (log.length) note('request shapes tried', log.join(' | '));
        if (ZFClient._callShape()) note('accepted shape', ZFClient._callShape());
        renderDiagnostics();
        renderDetails();

        if (BoughtNote.isEmpty(state.note)) {
          if (state.lookupError) {
            setStatus('error', 'Could not read this bill from Zoho Books: ' + state.lookupError);
          } else {
            setStatus('info', 'This bill has no line items to print.');
          }
          return;
        }
        setStatus('ok', 'Bill loaded. Ready to print the Bought Note.');
        $('print-btn').disabled = false;
        fit();
      })
      .catch(function (err) {
        setStatus('error', err.message || String(err));
        fit();
      });
  }

  function boot() {
    $('print-btn').addEventListener('click', openPrint);
    $('reload-btn').addEventListener('click', load);

    try { probeSdk(); } catch (e) { note('probe failed', e && e.message || String(e)); }
    try { renderDiagnostics(); } catch (e) { /* reported on next note */ }

    if (!ZFClient.available()) {
      setStatus('error', 'This widget must run inside Zoho Books.');
      return;
    }
    var INIT_TIMEOUT_MS =
      (typeof location !== 'undefined' && /[?&]fastTimeouts=1/.test(location.search))
        ? 600 : 10000;
    var initDone = false;

    function proceed(how) {
      if (initDone) return;
      initDone = true;
      note('extension.init', how);
      load();
    }

    setTimeout(function () {
      proceed('timed out after ' + (INIT_TIMEOUT_MS / 1000) + 's - continuing anyway');
    }, INIT_TIMEOUT_MS);

    try {
      var p = ZFClient.init();
      if (p && typeof p.then === 'function') {
        p.then(function () { proceed('ok'); },
               function (err) { proceed('rejected: ' + (err && err.message || err)); });
      } else {
        proceed('did not return a promise');
      }
    } catch (e) {
      proceed('threw: ' + (e && e.message || e));
    }
  }

  function whenReady() {
    (window.__sdkReady || Promise.resolve()).then(boot);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
})();
