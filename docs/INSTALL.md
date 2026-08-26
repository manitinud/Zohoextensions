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

One setting usually needs attention before the first print.

**Settings → Extensions & Developer Data → Installed Extensions → e-Invoice
Print → Settings.**

- **Source** — where IRN / Ack / signed QR come from:
  - *Zoho Books e-invoicing only* — the org pushes invoices to the IRP through
    Books. Nothing else to configure.
  - *Custom fields only* — the IRN was generated elsewhere (a GSP, the
    government portal, a migration) and parked on the invoice as custom fields.
    Fill in the four API names below.
  - *Zoho Books first, then custom fields* — the default; useful when an org has
    a mix of both, e.g. historical invoices imported with their IRNs plus new
    ones pushed through Books.
- **Custom field API names** — use the *API name*, not the label. Find them under
  **Settings → Preferences → Invoices → Field Customization**. The signed-QR
  field must hold the complete JWS string the IRP returned; a truncated field
  produces a QR that will not validate.
- **Repeating page header** — which rows appear in the band on every page.

### Using it

Open a completed invoice → **e-Invoice Print** panel → **Print e-Invoice**.

The panel states what it found before you print. If it says the signed QR is
missing, the printed copy will carry the IRN and Ack details but no scannable
QR — fix the data rather than distributing that copy as a compliant e-invoice.

Choose **Save as PDF** as the print destination to keep a file. Allow pop-ups for
Zoho Books, or the print window will be blocked.

### Permissions and data

The extension reads the invoice and organization through the signed-in user's own
Books session. It stores only its own settings, per organization. It sends
nothing to any third-party server — the QR is generated in the browser, and the
print window is fully self-contained.

---

## For the publisher

### 1. Build the extension in Sigma

1. Sign in to [sigma.zoho.in](https://sigma.zoho.in) (or `.com`, matching your
   data centre) → **Extensions** → **New Extension**.
2. Choose **Zoho Books** as the service.
3. Fill in name, description, and category.

Sigma then gives you a project skeleton. Replace its `app/` and
`plugin-manifest.json` with the contents of `extension/` from this repository —
either through Sigma's web editor, or by uploading a zip of the `extension/`
directory's *contents* (the zip root must contain `plugin-manifest.json`, not a
folder containing it):

```
cd extension && zip -r ../einvoice-print.zip . -x '.*' && cd ..
```

### 2. Verify the two widget locations

`plugin-manifest.json` registers two widgets:

| Widget | Purpose | `location` in this repo |
| --- | --- | --- |
| `einvoice_print_invoice` | panel on the invoice detail page | `invoice.details.rightpanel` |
| `einvoice_print_settings` | per-org settings page | `settings.custom` |

**Confirm these two strings against the dropdown Sigma shows when you add a
widget.** Zoho's placeholder names are versioned per service, and a value that
does not match one Sigma offers means the widget silently never renders. Sigma's
widget dialog is authoritative; take the value from there and update the manifest
if it differs. Everything else in this repository is independent of which
placeholder you land on.

### 3. Test against a real organization

Sigma's **Test** / **Preview** mode installs the extension into an org you pick.
Use an org that actually has e-invoiced invoices — the interesting failure modes
(missing signed QR, a key style the resolver has not seen, a very long JWS) only
show up on real data.

Worth checking explicitly:

- an invoice with 40+ line items, to see the header repeat across pages
- an invoice that was **never** e-invoiced, to confirm the panel says so cleanly
- an invoice whose IRN came from outside Books, with the custom-field source

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

Publish a new version from Sigma. Installed orgs pick it up; per-org settings
persist across versions because they are stored under the extension's own
storage key.
