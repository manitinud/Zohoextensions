# e-Invoice Print for Zoho Books

A Zoho Books extension that takes **the organization's own invoice PDF** and adds
the e-invoice band — QR code, IRN, Ack No., Ack Date — to the top of **every
page**.

It does not render its own invoice layout. Every organization customises its
Books template, and that template is the document their customers expect, so the
PDF is fetched exactly as Books renders it and the band is stamped above the
existing artwork.

Everything comes from the e-invoice Zoho Books already filed when the invoice was
pushed to the IRP. There is nothing to configure and nothing to enter.

![Page 1](docs/img/sample-page1.png)

Page 2 of the same invoice — the band repeats, and the client's own table styling
is untouched beneath it:

![Page 2](docs/img/sample-page2.png)

## What it does

- Adds a panel to the invoice detail sidebar in Zoho Books.
- Reads `einvoice_details` off the invoice: IRN, Ack No., Ack Date, status and
  the QR image link Books issued.
- Fetches the invoice PDF **as the organization's own template renders it**, plus
  the QR image Books issued for the e-invoice.
- Rebuilds each page as: the original page embedded unchanged but scaled down
  slightly, with the e-invoice band in the strip freed at the top. Aspect ratio
  is preserved, so nothing in the client's design distorts.
- Opens the result in a new tab to print or save.

The extension is read-only. Nothing in Zoho Books is modified.

### Removing the existing e-invoice block

Books templates that already print the IRN somewhere in the body will now show it
twice. Turn that block off in the org's **invoice template settings** — the
extension cannot remove content from a rendered PDF, only add to it.

## What Books actually returns

Confirmed against a live e-invoiced organization:

```json
"einvoice_details": {
  "inv_ref_num":      "53801fe38316ea9f7eb31b1a0074f8952378ba1eb4aa6b5c46815a92f95d5ff0",
  "ack_number":       "152625262386743",
  "ack_date":         "2026-04-02 11:18:00",
  "status":           "pushed",
  "status_formatted": "Pushed",
  "is_cancellable":   false,
  "qr_link":          "https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c…"
}
```

Two details that drive the implementation:

- **The IRN is `inv_ref_num`**, not `irn` — Books names it after the GST term
  "Invoice Reference Number". Reading `irn` returns nothing.
- **There is no signed-QR string.** Books exposes the QR as an image URL it
  serves itself. So the extension *fetches* the QR; it never generates one.
  That is the right outcome regardless — an e-invoice QR is an IRP signature,
  and anything generated locally would scan but fail validation.

## The one constraint worth knowing up front

**A Zoho Books extension cannot change how Books renders its own invoice PDF.**
The template engine owns that output and places the e-invoice block once per
document, not once per page.

So the extension does not try to patch the template. It takes the finished PDF
and stamps the band onto every page of it — which preserves the org's design
exactly while still meeting the every-page requirement.

Practical consequences:

- Each page's content is scaled down by roughly the band's height to make room.
  The design is unchanged, just marginally smaller.
- Output goes to a new browser tab. There is no server-side generation and no
  automatic attachment back onto the invoice record.
- An existing IRN block in the template must be switched off in template settings
  to avoid printing it twice; content cannot be removed from a rendered PDF.
- If an org is content with the QR appearing once, Books does that natively and
  no extension is needed. The gap this fills is the *every page* requirement.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning in full.

## Installing

- **A customer installing the published extension** — a few clicks from
  Settings, then it works. See [docs/INSTALL.md](docs/INSTALL.md#for-the-customer).
- **You, publishing it from Sigma** — build, test in a real org, then publish
  privately (a link for named orgs) or to the public marketplace. See
  [docs/INSTALL.md](docs/INSTALL.md#for-the-publisher).

## Repository layout

```
extension/                  a ZET project — `zet validate` and `zet pack` both pass
  plugin-manifest.json      service FINANCE, widget at invoice.details.sidebar
  app/
    widget.html             the widget
    css/widget.css
    translations/en.json
    img/logo.png
    js/
      app.js                widget controller (print appearance constants live here)
      zf-client.js          ZFAPPS SDK wrapper (invoice, org, Books API)
      einvoice.js           reads einvoice_details off the invoice
      qr-image.js           fetches Books' QR image, inlines it as a data URI
      pdf-stamp.js          stamps the band onto every page of the org's own PDF
      vendor-pdf-lib.js     pdf-lib 1.17.1 (MIT)
docs/
test/
```

## Building the package

Zoho Books extensions are built with the Zoho Extension Toolkit, not by hand-zipping:

```
npm install -g zoho-extension-toolkit
cd extension
zet validate      # passes
zet pack          # writes dist/extension.zip — this is what you upload
zet run           # serves locally for Developer Mode testing
```

`plugin-manifest.json` matches the toolkit's own `finance` template: `service` is
`FINANCE` (not `ZOHOBOOKS`), connections are declared under `usedConnections`,
translations live at `app/translations/`, and the SDK is loaded from
`static.zohocdn.com/zohofinance/v1.0/zf_sdk.js`.

## Tests

```
node test/run.js           # 35 unit assertions: real einvoice_details payloads from
                           # live orgs, QR normalisation, IRN wrapping, call-shape
                           # construction, eInvoiceID extraction
node test/verify-stamp.js  # builds a branded multi-page "client template" PDF,
                           # stamps it, asserts every page carries the band AND
                           # still contains the client's own content
node test/widget-e2e.js    # runs the real widget in Chromium against a mocked
                           # ZFAPPS: 26 assertions across five scenarios, ending
                           # with a Print that produces a stamped PDF
```

### Testing without a live organization

`widget-e2e.js` exists because the alternative was testing in a client's
production Books org, which is not acceptable. `test/mock-zfapps.js` reproduces
what the real SDK was observed to do in a live run — including the two behaviours
that cost the most time:

- `extension.init()` and `request()` can **hang**: neither resolving nor
  rejecting. Every failure therefore looked like a freeze, and every wrong guess
  looked identical to every other wrong guess.
- `get('invoice')` returns an invoice with **no `einvoice_details`**, so the
  details must come from an API Configuration call.

The scenarios cover the happy path, a hanging `init`, every request hanging, a
run where only a nested argument shape is accepted, and the Print path end to
end. Timeouts are shortened via a `?fastTimeouts=1` flag so a full run takes
seconds.
