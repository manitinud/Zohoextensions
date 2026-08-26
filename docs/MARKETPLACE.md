# Public marketplace submission

Copy for the Zoho review submission, plus the notes that pre-empt the likely
rejection reasons.

## Listing description

The draft on the extension currently reads:

> Where you can print e invoice details with QR along with Invoice details where
> e invocie QR and details will be header.

That has a typo ("invocie") and does not parse. Reviewers weigh listing quality,
and this text is what every prospective user reads. Replace it with:

**Short description** (one line, for the gallery card)

```
Print an e-invoice copy with the QR code and IRN repeated at the top of every page.
```

**Long description**

```
e-Invoice Print adds a panel to the invoice detail page in Zoho Books that prints
a completed invoice as an e-invoice copy — with the QR code, IRN, Acknowledgement
Number and Acknowledgement Date repeated at the top of every page, not just the
first.

Multi-page tax invoices are the reason this exists. Zoho Books places the
e-invoice block once per document, so on a five-page invoice only page one
carries the IRN and QR. This extension reprints that band as a running page
header, so every page of the printed copy is identifiable on its own.

Everything is read from the e-invoice Zoho Books has already filed against the
invoice when it was pushed to the IRP. There is nothing to configure, no fields
to map and no data to enter. Open an invoice, click Print e-Invoice, and choose
your printer or Save as PDF.

The QR code is the one Zoho Books issued for the e-invoice — it is fetched, never
regenerated — so the printed code is the signed QR from the IRP.

Key points
• QR code, IRN, Ack No. and Ack Date at the top of every printed page
• Reads the e-invoice already recorded in Zoho Books — zero setup
• Prints the full tax invoice: parties, GSTINs, place of supply, HSN/SAC
  line items, tax breakup, totals and amount in words
• Read-only. Nothing is written back to Zoho Books and nothing is stored
• Designed for Indian GST e-invoicing
```

## Category

Accounting / Compliance (or Taxes, if that is offered) — not Payments.

## Privacy policy

Zoho requires a privacy policy URL. Host this text and link it. It is accurate
for the extension as built — check it still holds before reusing it on a later
version.

```
Privacy Policy — e-Invoice Print for Zoho Books

What the extension accesses
e-Invoice Print reads, from the Zoho Books organization it is installed in:
  • the invoice currently open, including its line items and e-invoice details
    (IRN, Acknowledgement Number, Acknowledgement Date, status, QR code link)
  • the organization's own profile (name, address, GSTIN)
It reads this through the signed-in user's existing Zoho Books session. It
requests no access to any other module or organization.

What it does with it
The data is used solely to render a printable e-invoice copy in the user's own
browser. The e-invoice QR code image is fetched from Zoho's own e-invoice
endpoint and embedded in that printed document.

What it does not do
  • It does not write, modify or delete anything in Zoho Books.
  • It does not store any invoice, customer or organization data — not on a
    server, and not in the browser.
  • It does not transmit any data to the publisher or to any third party. There
    is no external server involved; the extension makes no network requests
    other than to Zoho.
  • It does not use cookies, analytics or tracking of any kind.

Retention
No data is retained. Each time the panel is opened it reads the current invoice
afresh, and nothing persists after the page is closed.

Printed output
The printable copy is generated in the user's browser and goes to their chosen
printer or PDF destination. It is never uploaded anywhere.

Contact
<your support email>
```

## Screenshots

`docs/img/sample-page1.png` and `docs/img/sample-page2.png` are the printed
output, page 1 and page 2 of the same invoice. They are the right pair to submit
because side by side they demonstrate the one thing the extension claims: the
band repeats.

Add one screenshot of the panel in the Zoho Books sidebar once it is installed
somewhere — reviewers like seeing the in-product surface, and it is the first
thing a prospective user looks for.

## Reviewer notes

Worth pasting into the submission notes, because a reviewer testing on an
organization without e-invoicing will otherwise think the extension is broken:

```
Testing note

This extension surfaces e-invoice data that Zoho Books records when an invoice is
pushed to the IRP (Indian GST e-invoicing). On an invoice that was never
e-invoiced — or in an organization without e-invoicing enabled — the panel
correctly reports that there is no e-invoice on record. This is the expected
state, not a failure.

To see the full behaviour, open an invoice whose e-invoice status is "Pushed";
the panel then shows the IRN, Ack No., Ack Date and QR, and "Print e-Invoice"
produces the printable copy.

The printed document opens in a new browser window, so pop-ups must be allowed
for Zoho Books.

The extension is read-only: it performs no write operations against Zoho Books
and stores no data.
```

## Support email

Zoho will ask for one and will use it for user-reported issues. Use a monitored
shared address, not a personal one — a public listing means strangers with
different invoice templates raising questions.
