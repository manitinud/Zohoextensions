/* Settings widget controller. Presentation only - no data sources to configure. */
(function () {
  function $(id) { return document.getElementById(id); }

  function setStatus(kind, text) {
    var el = $('status');
    el.className = 'status status--' + kind;
    el.textContent = text;
  }

  function apply(s) {
    $('h-qr').checked = !!s.header.showQr;
    $('h-irn').checked = !!s.header.showIrn;
    $('h-ack').checked = !!s.header.showAck;
    $('h-gstin').checked = !!s.header.showGstin;
    $('h-status').checked = !!s.header.showStatus;
    $('h-pages').checked = !!s.header.showPageNumbers;
    $('qr-size').value = s.qrSizePx;
  }

  function collect() {
    var size = parseInt($('qr-size').value, 10);
    return {
      header: {
        showQr: $('h-qr').checked,
        showIrn: $('h-irn').checked,
        showAck: $('h-ack').checked,
        showGstin: $('h-gstin').checked,
        showStatus: $('h-status').checked,
        showPageNumbers: $('h-pages').checked
      },
      // Clamp rather than reject: an out-of-range size is a typo, not a reason
      // to throw away the rest of the form.
      qrSizePx: isNaN(size) ? EIStorage.DEFAULTS.qrSizePx : Math.min(300, Math.max(80, size))
    };
  }

  function save() {
    var s = collect();
    setStatus('info', 'Saving…');
    EIStorage.save(s).then(function () {
      apply(s);
      setStatus('ok', 'Settings saved.');
    }).catch(function (e) {
      setStatus('error', 'Could not save: ' + (e.message || e));
    });
  }

  function boot() {
    $('save-btn').addEventListener('click', save);
    $('reset-btn').addEventListener('click', function () {
      apply(EIStorage.DEFAULTS);
      save();
    });

    var start = ZFClient.available()
      ? ZFClient.init().catch(function () { /* fall through to the storage fallback */ })
      : Promise.resolve();

    start.then(EIStorage.load).then(function (s) {
      apply(s);
      setStatus('info', 'These settings apply to this organization.');
      ZFClient.resize(document.body.scrollHeight + 16);
    }).catch(function (e) {
      setStatus('error', e.message || String(e));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
