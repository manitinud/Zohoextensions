# Review questionnaire — e-Invoice Header Printout for Zoho Books

Responses to the six questions from the Zoho Marketplace review team.

---

## 1) Purpose of the extension, with the business use-case

**Purpose.** The extension produces a printable copy of an already e-invoiced
Zoho Books invoice with the e-invoice band — QR code, IRN, Ack No., Ack Date
and status — placed at the **top of every page** of the PDF.

**Business use-case.** GST-registered businesses in India push their invoices
to the Invoice Registration Portal (IRP) from Zoho Books. Books records the
IRN, acknowledgement details and the signed QR against the invoice. In day-to-day
trade — exports, shipping documentation, plant gate copies, bank submissions —
the printed invoice must show these e-invoice credentials prominently, and on
**every page** of a multi-page invoice, not once in the body where they can be
missed or separated from continuation pages.

Zoho Books prints these details once, wherever the organization's template
places them. This extension closes that gap:

- The user opens an invoice that has been pushed to the IRP and clicks
  **Print e-Invoice** in the sidebar panel.
- The extension fetches the invoice PDF **exactly as the organization's own
  customised Books template renders it** — it does not invent a layout — and
  stamps the e-invoice band into a strip freed at the top of each page (the
  original page is embedded unchanged, scaled slightly; nothing is redrawn or
  distorted).
- The result opens in a new tab, ready to print or save.

**Zero configuration.** Every value shown comes from the e-invoice record Zoho
Books already holds (`einvoice_details` on the invoice, the e-invoice record,
and the QR Books issued). There is nothing to enter at install time and no
settings screen. The extension works for any organization that installs it —
no organization-specific values are hardcoded.

**The extension is read-only.** It only reads invoice data through the scope
`ZohoBooks.invoices.READ`; nothing in Zoho Books is created, updated or
deleted, and no data leaves Zoho (no third-party services are called).

## 2) Documentation of the extension

Documentation is included with this response:

- **User documentation** — what the extension does, how to use it, and how to
  avoid the e-invoice block printing twice (organizations whose template
  already prints the IRN should remove that block from their template; the
  extension adds to a rendered PDF and cannot remove content from it).
- **Installation guide** — install from Marketplace, authorize the one
  connection, done. There are no configuration fields.
- **Architecture / component documentation** — every component in the
  extension and what it is for (also summarised in question 3's flow document).

(Repository files: `README.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md`.)

## 3) Explanatory video — flow document and component inventory

A screen-recorded video accompanies this response, following the flow below.
Every component in the extension appears in it.

### Components used in the extension (complete list)

| # | Component | Name | Purpose |
|---|-----------|------|---------|
| 1 | Widget (invoice details sidebar) | **e-Invoice Print** | The panel on the invoice detail page: shows IRN / Ack No. / Ack Date / Status / QR read from Books, with the Print e-Invoice button. |
| 2 | Widget (invoice edit view sidebar) | **e-Invoice Print (Edit View)** | The same panel surfaced on the invoice creation/edit view. |
| 3 | Connection | **zbooks** (Zoho OAuth) | Authorizes the API configurations. Scope: `ZohoBooks.invoices.READ` only — read-only. |
| 4 | API Configuration | **getinvoice** (`ac__in_wyw1vx3_getinvoice`) | `GET /books/v3/invoices/${url_param.invoice_id}?organization_id=${url_param.organization_id}&accept=json` — reads the invoice detail record including `einvoice_details`. |
| 5 | API Configuration | **getinvoicepdf** (`ac__in_wyw1vx3_getinvoicepdf`) | Same endpoint with `accept=pdf` — fetches the invoice PDF as the organization's own template renders it. |
| 6 | API Configuration | **geteinvoiceqr** (`ac__in_wyw1vx3_geteinvoiceqr`) | `GET /books/v3/invoices/${url_param.invoice_id}/einvoice` — reads the e-invoice record (source of the signed QR text where the organization stores it). |
| 7 | API Configuration | **getqrimage** (`ac__in_wyw1vx3_getqrimage`) | `GET https://books.zoho.in/einvoice/qrcode?eInvoiceID=${url_param.eInvoiceID}` — fetches the QR image Zoho Books issued for the e-invoice, so it can be embedded permanently in the printed PDF. |
| 8 | Global Field | **organization_id** (`vl__in_wyw1vx3_organization_id`, Hidden) | Stores the installing organization's ID, written once by the install action. Hidden so installation asks the user nothing. |
| 9 | Global Field | **invoice_ids** (`vl__in_wyw1vx3_invoice_ids`, Hidden) | Reserved field from the same design; Hidden, never shown to the user. |
| 10 | Install Action (Deluge) | **Install_Function** | On install/upgrade, reads `organization.get("organization_id")` and stores it in the organization_id global field. This is the entire install-time logic. |

At runtime the widget passes `invoice_id` and `organization_id` (taken live
from the widget context, so the extension is multi-organization by design) as
`url_param` values; the API configurations substitute them into the stored
URLs. No URL is constructed in widget code.

### Video flow (shot by shot)

1. **Developer portal — components.** Show the extension in the Zoho Books
   Developer Portal: the two widgets, the zbooks connection, the four API
   configurations (open each, showing URL and parameters), the two Global
   Fields (showing Hidden visibility), and the Install Action Deluge script.
2. **Installation.** Install the extension into a Zoho Books organization:
   select organization → authorize the zbooks connection → install completes
   with **no configuration questions**.
3. **Non e-invoiced invoice.** Open an ordinary invoice → the e-Invoice Print
   panel states the invoice has no e-invoice on record. (Shows the widget on
   the invoice details sidebar.)
4. **E-invoiced invoice.** Open an invoice that has been pushed to the IRP →
   the panel shows IRN, Ack No., Ack Date, Status, and "QR: embedded in
   print", all read from Zoho Books with no user input.
5. **Print.** Click **Print e-Invoice** → a new tab opens with the
   organization's own invoice template, with the e-invoice band (QR, IRN, Ack
   No., Ack Date, Status) at the top of every page. Scroll a multi-page
   invoice to show the band repeating.
6. **Edit view widget.** Open an invoice in edit view and show the same panel
   there (the second widget).

## 4) Marketplace or organization-specific?

Developed for **publishing on the Zoho Marketplace**, for all Zoho Books
organizations (India edition / e-invoicing users). It is not restricted to a
specific organization: no organization ID is hardcoded anywhere, and the
install action derives the installing organization's ID automatically.

## 5) Paid or free?

**Free.**

## 6) Extension Review Guidelines

Yes — the extension was developed following the Extension Review Guidelines:

- Least privilege: a single Zoho OAuth connection with the single read-only
  scope `ZohoBooks.invoices.READ`. No write scopes, no other Zoho services.
- No external/third-party services: every API configuration points at Zoho's
  own endpoints; no customer data leaves Zoho. The extension stores no data
  anywhere (no external storage, no analytics, no tracking).
- All API access goes through declared API Configurations with the declared
  connection — no raw URLs in widget code.
- Global fields are Hidden and the install action is a minimal Deluge function,
  so installation asks the user for nothing.
- Built with the ZET toolkit and ZFAPPS SDK v2.0; `zet validate` passes.

No open difficulties with the guidelines. One small piece of feedback for the
portal team, not a blocker: on an API configuration form, a header row that has
been removed re-appears in the UI after saving; unrecognised headers appear to
be ignored server-side, so this did not affect the extension's behaviour.
