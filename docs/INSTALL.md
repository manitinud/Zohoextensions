# Installing

## For the customer

This is what the person running the Zoho Books org does. It is the flow you saw
in Settings — the extensions marketplace built into Books.

### If the extension is published publicly

1. In Zoho Books: **Settings** (gear icon) → **Extensions & Developer Data** →
   **All Extensions**.
2. Search for **e-Invoice Print**.
3. Open it and click **Install**.
4. Accept the permission prompt. The extension asks only to read invoices and
   organization details.
5. Open any invoice. The **e-Invoice Print** panel appears on the invoice detail
   page.

### If the extension is published privately

A private extension does not appear in the marketplace search. Instead:

1. You (the publisher) add the customer's **organization ID** to the extension's
   private-install list in Sigma, or send them the private install URL Sigma
   generates.
2. The customer opens that URL while signed in to the right Books org, and
   clicks **Install**.
3. From there it is identical — the panel appears on the invoice detail page.

To find their organization ID: **Settings → Organization Profile**, or read it
from the `organization_id` in the URL.

### First-run configuration

None. Open an invoice and print it.

The IRN, Ack No., Ack Date, status and QR are read from the e-invoice Zoho Books
already filed against the invoice when it was pushed to the IRP. There is no data
source to pick and nothing to map.

There is no settings page at all. How the printed band looks is fixed in the
extension itself (`app/js/app.js`), so if a client wants a row dropped or the QR
resized, that is a change on the publisher's side and a new version — not
something the customer configures.

### Using it

Open a completed invoice → **e-Invoice Print** panel → **Print e-Invoice**.

The panel states what it found before you print:

- *e-Invoice details loaded from Zoho Books* — everything is there.
- *Books has no e-invoice record for this invoice* — the invoice was never pushed
  to the IRP, or it is a document type that is not e-invoiced (a bill of supply,
  for instance). There is nothing to print an e-invoice copy from.
- *The QR is linked rather than embedded* — the copy will print, but a saved PDF
  will only show the QR while you are signed in to Books. Print it now, or
  re-run it later from Books.

Choose **Save as PDF** as the print destination to keep a file. Allow pop-ups for
Zoho Books, or the print window will be blocked.

### Permissions and data

The extension reads the invoice and organization through the signed-in user's own
Books session, and fetches the QR image from Zoho's own e-invoice endpoint. It
writes nothing back to Books and stores nothing at all. No data goes to any
third-party server, and the print window makes no external requests once it
opens.

---

## For the publisher

### 1. Build the package

Zoho Books extensions are built with the Zoho Extension Toolkit (`zet`), not by
uploading a hand-made zip. Sigma's "Edit Extension" hands off to the Books
Developer Portal, which expects a `zet pack` bundle.

```
npm install -g zoho-extension-toolkit
cd extension
zet validate      # checks the manifest and file layout
zet pack          # writes dist/extension.zip
```

Upload `dist/extension.zip` via **Widgets → Upload widget** in the Developer
Portal.

### 2. Test locally first

```
zet run
```

Then enable **Developer Mode** in the Zoho Books org and open any invoice. The
widget is served from your machine, so edits show up on reload — much faster than
re-packing and re-uploading for every change.

Test against an org that actually has e-invoiced invoices. Worth checking
explicitly:

- an invoice with 40+ line items, to see the header repeat across pages
- an invoice that was **never** e-invoiced, to confirm the panel says so cleanly
- that the QR arrives **embedded** rather than linked. If the panel reports it as
  linked, `ZFAPPS.request` is not returning the image bytes in a shape
  `qr-image.js` recognises; the normalisation in `QRImage.fetchQr` is the place
  to adjust, and the printed PDF is not portable until it is fixed

### 3. Widget placement

The manifest places the widget at `invoice.details.sidebar` — the sidebar of the
invoice **detail** page, which is where a completed invoice is viewed.

The other Finance placement is `invoice.creation.sidebar`, which appears while an
invoice is being created or edited. That is the wrong one here: this extension
prints invoices that are already done and already e-invoiced.

### 4. Publish

In Sigma, **Publish**:

- **Private** — you nominate which organizations may install it. This is the
  right choice for a client-specific build, and for anything customised to one
  org's invoice layout. No Zoho review queue.
- **Public** — listed in the marketplace for every Books user. Goes through
  Zoho's review, which takes a few working days and will ask for a description,
  screenshots, a support email and a privacy policy.

Private publishing is almost certainly what you want first: it is immediate, and
it lets you iterate on the layout with a real customer before committing to a
public listing.

### 5. Updating

Bump the version, run `zet pack` again, and upload the new `dist/extension.zip`.
Installed orgs pick it up. The extension keeps no stored state, so there is
nothing to migrate between versions.
