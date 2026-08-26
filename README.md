# e-Invoice Print for Zoho Books

A Zoho Books (Sigma) extension that prints an already-completed invoice as an
e-invoice copy, with the **QR code and e-invoice details repeated at the top of
every page**.

![Page 1](docs/img/sample-page1.png)

Page 2 of the same invoice — the band repeats, it is not a first-page-only header:

![Page 2](docs/img/sample-page2.png)

## What it does

- Adds a panel to the invoice detail page in Zoho Books.
- Reads the invoice's IRN, Ack No., Ack Date and **signed QR** — from Books' own
  e-invoicing, or from custom fields when the IRN was generated outside Books.
- Renders the signed QR to an image and builds a printable A4 document where the
  e-invoice band sits in a repeating page header.
- Opens the browser print dialog; "Save as PDF" gives the customer the file.

Nothing in Zoho Books is modified. The extension only reads.

## The one constraint worth knowing up front

**A Sigma extension cannot change how Zoho Books renders its own invoice PDF.**
The Books template engine owns that output, and it places the e-invoice block
once per document, not once per page. So this extension does not try to patch the
Books template — it produces its **own** print layout, which is what makes a
per-page header possible at all.

Practical consequences:

- The printed copy is this extension's layout, not the org's Books template. If a
  customer needs their exact Books template design, the layout in
  `extension/app/js/print-doc.js` has to be matched to it.
- Output goes through the browser's print dialog. There is no silent
  server-side PDF generation and no automatic attachment to the invoice record.
- If the org already pushes e-invoices through Zoho Books **and** is happy with
  the QR appearing once, Books does that natively and no extension is needed.
  The gap this fills is the *every page* requirement, and IRNs generated outside
  Books.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning in full.

## The signed QR cannot be faked

The QR on a GST e-invoice must contain the **signed QR string** (a JWS) returned
by the IRP. It is a signature over the invoice and cannot be reconstructed from
the IRN, the invoice number, or anything else held locally.

So: if the signed QR is not retrievable for an invoice, the extension prints the
IRN and Ack details and says plainly that the QR is missing, rather than drawing
a QR that would not validate. Getting the signed QR onto invoices whose IRN was
generated outside Books is a data problem to solve before printing — see the
custom-field settings in the extension.

## Installing

Two different audiences, two different documents:

- **A customer installing the published extension** — a few clicks from
  Settings. See [docs/INSTALL.md](docs/INSTALL.md#for-the-customer).
- **You, publishing it from Sigma** — build, test in a real org, then publish
  either privately (a link for named orgs) or to the public marketplace. See
  [docs/INSTALL.md](docs/INSTALL.md#for-the-publisher).

## Repository layout

```
extension/
  plugin-manifest.json      widget registration
  app/
    index.html              invoice-detail widget
    settings.html           per-organization settings
    css/widget.css
    js/
      app.js                invoice widget controller
      settings.js           settings controller
      zf-client.js          ZFAPPS SDK wrapper (invoice, org, Books API)
      einvoice.js           resolves IRN/Ack/signed QR across key styles
      qr.js                 signed QR -> PNG data URI
      print-doc.js          builds the printable document
      storage.js            per-org settings persistence
      vendor-qrcode*.js     qrcode-generator 2.0.4 (MIT, Kazuhiko Arase)
docs/
test/
```

## Tests

```
node test/run.js          # 31 assertions: number-to-words, Indian digit grouping,
                          # e-invoice field resolution, document structure, escaping
node test/verify-print.js # renders a 70-line invoice to PDF in Chromium and asserts
                          # the e-invoice band lands on every page
node test/preview.js      # end-to-end: real QR through qr.js, decoded back out of
                          # the rendered page, page images written to test/
```

`verify-print.js` and `preview.js` need Playwright and pdf.js. They are the
checks that matter — the repeating header and the QR surviving print are the two
claims this extension lives or dies by, and both are verified rather than assumed.

## Licence notes

`extension/app/js/vendor-qrcode.js` and `vendor-qrcode-utf8.js` are
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by
Kazuhiko Arase, MIT licensed, vendored unmodified. They are bundled rather than
loaded from a CDN because the print window must render with no network access.
