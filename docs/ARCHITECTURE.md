# Architecture and the reasoning behind it

## The problem

Print an already-completed Zoho Books invoice as an e-invoice copy, with the QR
code and e-invoice details visible in the header of **every** page.

## Why this is not a template change

The obvious approach — edit the Zoho Books invoice template to add the QR and
IRN, and mark that block as a page header — does not work, for two separate
reasons:

1. **A Sigma extension cannot touch the Books PDF renderer.** Extensions get
   widgets, custom buttons, custom functions and API access. The invoice PDF is
   produced by Books' own template engine, which is not an extension surface.
   There is no hook that injects markup into it.
2. **Even by hand, the template puts the e-invoice block once.** Zoho Books does
   support showing e-invoice details and the QR on the invoice template when the
   org pushes e-invoices through Books — but as a block in the document body, not
   as a repeating page header. An org that only needs the QR once already has
   this natively and needs no extension.

So the requirement "on every page" forces the extension to own the layout. That
is the central design decision here, and everything else follows from it.

## The shape that results

```
Books invoice detail page
        │
        │  ZFAPPS.get('invoice')          invoice already in widget context
        ▼
  ┌───────────────┐
  │  widget panel │
  └───────┬───────┘
          │  einvoice.js  ── resolve IRN / Ack / signed QR
          │                    ├─ invoice.einvoice_details        (Books)
          │                    ├─ GET /invoices/{id}/einvoice     (Books, IRP-shaped)
          │                    └─ invoice custom fields           (external IRN)
          │
          │  qr.js        ── signed QR (JWS) → PNG data URI
          │
          │  print-doc.js ── self-contained HTML document
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

This is verified, not assumed: `test/verify-print.js` renders a 70-line-item
invoice to PDF in Chromium, extracts the text of each page, and asserts the IRN
and Ack No. appear on all of them.

## Resolving e-invoice fields

The same four values arrive under different key styles depending on where they
come from:

| Source | Key style | Example |
| --- | --- | --- |
| `invoice.einvoice_details` | Books snake_case | `irn_number`, `ack_number` |
| `GET /invoices/{id}/einvoice` | IRP PascalCase | `Irn`, `AckNo`, `AckDt`, `SignedQRCode` |
| invoice custom fields | whatever the org chose | `cf_irn`, `cf_signed_qr` |

Rather than hard-coding one key per source, `einvoice.js` gives each field a list
of aliases and walks the response looking for them — normalising case and
punctuation, descending through nested objects and single-element arrays, capped
at five levels deep. Direct hits at a level win over nested ones, so a stale
nested copy never shadows the current value.

This is deliberate defensiveness: the exact key names Books returns for
e-invoices could not be confirmed against a live e-invoiced org while building
this (`www.zoho.com` and `help.zoho.com` are unreachable from the build
environment, and the orgs reachable through the API had no e-invoiced documents).
The alias approach means the extension works across all the plausible shapes
instead of betting on one. If it ever fails to find a field on real data, adding
the observed key to the relevant `ALIASES` array is a one-line fix.

The dedicated `/einvoice` endpoint is only called when the invoice object alone
did not yield a signed QR, since on a non-e-invoiced invoice it returns an error
rather than an empty body — an expected outcome, so it is swallowed rather than
surfaced as a failure.

## The signed QR

The QR on a GST e-invoice carries the **signed QR string**: a JWS the IRP
returns, signed with the IRP's key, covering the invoice's key fields. It is a
signature. It cannot be derived from the IRN or rebuilt from invoice data.

Consequences the code honours:

- If no signed QR is retrievable, the document prints with a clearly-labelled
  placeholder saying so. It never draws a QR containing substitute content,
  because such a QR would scan and then fail validation — worse than no QR.
- Encoding uses error-correction level **L**, which gives the largest capacity
  (2953 bytes). Real signed QRs run roughly 800–1500 characters, so this leaves
  headroom. Above 2953 bytes `qr.js` raises a message naming the actual size
  rather than letting the encoder throw something opaque.
- The QR is rasterised at ≥3× its printed CSS size. A signed QR needs a
  97–129 module symbol; at one device pixel per module the browser would upscale
  a too-small image and soften the edges, which scanners handle badly.
  Oversampling and letting CSS scale down keeps whole, sharp modules at print
  resolution.

`test/preview.js` closes the loop: it generates a QR from a realistic JWS through
the extension's own `qr.js`, renders the document, reads the QR image back out of
the laid-out page, and decodes it — asserting the recovered string is
byte-identical to the input.

## Self-containment

The print document is opened in a new window and may be saved as PDF or reopened
offline. It therefore embeds everything: styles inline, QR as a `data:` URI, no
external requests. The QR library is vendored into the extension for the same
reason — a CDN reference would be a runtime dependency inside a document that is
supposed to be a permanent record.

## What this design does not give you

Worth stating plainly, because these are the questions that come back later:

- **Not the org's Books template.** The layout is this extension's. Matching a
  particular org's invoice design means editing `print-doc.js`.
- **No server-side PDF.** Output goes through the browser's print dialog. There
  is no headless render, so no scheduled generation and no automatic attachment
  back onto the invoice record.
- **No bulk print.** One invoice at a time, from its detail page. Bulk would mean
  a second widget on the invoice list plus batched API reads — feasible on this
  foundation, but not built.
- **Nothing is written back to Books.** The extension is read-only by design.
