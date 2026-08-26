# Architecture and the reasoning behind it

## The problem

Print an already-completed Zoho Books invoice as an e-invoice copy, with the QR
code and e-invoice details visible in the header of **every** page — pulling
everything from the e-invoice Books has already filed, with no data entry.

## Why this is not a template change

The obvious approach — edit the Zoho Books invoice template to add the QR and
IRN, and mark that block as a page header — does not work, for two separate
reasons:

1. **A Sigma extension cannot touch the Books PDF renderer.** Extensions get
   widgets, custom buttons, custom functions and API access. The invoice PDF is
   produced by Books' own template engine, which is not an extension surface.
   There is no hook that injects markup into it.
2. **Even by hand, the template places the e-invoice block once.** Books does
   support showing e-invoice details and the QR on the template — but as a block
   in the document body, not as a repeating page header.

So "on every page" forces the extension to own the layout. That is the central
design decision, and everything else follows from it.

## The shape that results

```
Books invoice detail page
        │
        │  ZFAPPS.get('invoice')             invoice already in widget context
        ▼
  ┌───────────────┐
  │  widget panel │
  └───────┬───────┘
          │  einvoice.js   ── read invoice.einvoice_details
          │                    (re-read via API if the context copy is abridged)
          │
          │  qr-image.js   ── GET einvoice_details.qr_link through the ZFAPPS
          │                    proxy → inline as a data URI
          │
          │  print-doc.js  ── self-contained HTML document
          ▼
   window.open() → browser print dialog → printer or Save as PDF
```

## Getting a header onto every page

The mechanism is the `<thead>` of a table that spans the whole document:

```html
<table class="sheet">
  <thead><tr><td> e-invoice band: QR, IRN, Ack No., Ack Date </td></tr></thead>
  <tbody><tr><td> parties, line items, totals </td></tr></tbody>
  <tfoot><tr><td> page footer line </td></tr></tfoot>
</table>
```

Print engines repeat `thead` rows at the top of each page a table breaks onto.
This was chosen over `position: fixed`, which several engines paint only on the
first page, and over `@page` margin boxes, which cannot hold an image.

Verified, not assumed: `test/verify-print.js` renders a 70-line-item invoice to
PDF in Chromium, extracts the text of each page, and asserts the IRN and Ack No.
appear on all of them.

## Reading the e-invoice

There is exactly one source: the `einvoice_details` object Books writes onto the
invoice when it is pushed to the IRP. Confirmed live:

```json
{
  "is_cancellable": false,
  "inv_ref_num": "53801fe38316ea9f7eb31b1a0074f8952378ba1eb4aa6b5c46815a92f95d5ff0",
  "status_formatted": "Pushed",
  "ack_number": "152625262386743",
  "qr_link": "https://books.zoho.in/einvoice/qrcode?eInvoiceID=2-48da5c…",
  "status": "pushed",
  "formatted_status": "Pushed",
  "ack_date": "2026-04-02 11:18:00"
}
```

Field mapping:

| Printed as | Books key |
| --- | --- |
| IRN | `inv_ref_num` |
| Ack No. | `ack_number` |
| Ack Date | `ack_date` |
| e-Invoice status | `status_formatted`, falling back to `status` |
| QR image | `qr_link` |

`einvoice.js` accepts a couple of alternate names per field (`irn`, `irn_number`
and so on). That is not hedging about the shape above — it is confirmed. It is
because Books runs per data centre and the invoice-*list* payload already returns
a trimmed version of this object, without `qr_link`. A cheap alias list costs
nothing and avoids a silently blank field on a variant.

For the same reason, when the invoice handed over by ZFAPPS carries no `qr_link`,
the extension re-reads the invoice through the API before concluding there isn't
one. The difference between "not e-invoiced" and "the context object was
abridged" matters to what the user gets told.

## The QR

Books does not return a signed-QR string; it returns `qr_link`, a URL to an image
it serves. So the extension fetches that image rather than encoding anything.
This is the correct behaviour on the merits too: the QR on a GST e-invoice
carries the IRP's signature over the invoice, and anything generated locally
would scan and then fail validation.

The fetch goes through `ZFAPPS.request`, not the browser, for two reasons:

- `qr_link` is cross-origin to the widget's iframe and Books sends no CORS
  headers for it, so `fetch()` would be blocked.
- The print document is opened in a separate window and usually saved as PDF. A
  remote `<img src>` would leave that saved file dependent on a live Zoho session
  to render — possibly blank months later. Inlining the bytes as a data URI keeps
  the printed copy self-contained.

If the proxy fetch fails, the document falls back to referencing `qr_link`
directly and the widget says so explicitly, rather than pretending the PDF is
portable when it is not.

## What this design does not give you

Worth stating plainly, because these are the questions that come back later:

- **Not the org's Books template.** The layout is this extension's. Matching a
  particular org's invoice design means editing `print-doc.js`.
- **No server-side PDF.** Output goes through the browser's print dialog, so no
  scheduled generation and no automatic attachment onto the invoice record.
- **No bulk print.** One invoice at a time, from its detail page. Bulk would mean
  a second widget on the invoice list plus batched API reads — feasible on this
  foundation, but not built.
- **Invoices e-invoiced outside Books are out of scope.** If the IRN was
  generated through a GSP or the government portal and never recorded in Books,
  `einvoice_details` is empty and the extension says so. Reading such IRNs from
  custom fields is a small addition to `einvoice.js` if it is ever needed.
