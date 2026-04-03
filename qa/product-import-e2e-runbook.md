# Product Import E2E Runbook

This runbook verifies the hardened CSV import flow after switching to `Node 20.10.x` and `npm 10.x`.

## 1. Environment

Use:

- `Node 20.10.x`
- `npm 10.x`

From the repo root:

```powershell
cd web
npm install
cd ..
```

Start the app in the normal local embedded-app flow you already use for Shopify auth.

## 2. Prepare a Real Fixture

Edit [product-import-smoke.csv](C:\Users\Venugopal K J\Downloads\Neon-MetaMatrix-translate\Neon-MetaMatrix-translate\qa\fixtures\product-import-smoke.csv) and replace:

- `REPLACE_PRODUCT_ID`
- `REPLACE_VARIANT_ID`

Use a real product and variant id that already exist in the app mirror for the test shop.

The default column mappings assumed by the script are:

```json
{"Product ID":"id","Variant ID":"variant_id","Title":"title","Price":"price"}
```

## 3. Get a Session Token

Open the embedded app in Shopify admin and obtain a session token from the browser context.

One easy approach from the browser console is to call the same App Bridge token helper used by authenticated fetch, then paste the token into the script command.

You need a valid bearer token because `/api/products/csv/import` is behind `shopify.validateAuthenticatedSession()`.

## 4. Run the Upload Script

From the repo root:

```powershell
.\scripts\manual-test-product-import.ps1 `
  -ApiBaseUrl "http://localhost:3000" `
  -SessionToken "<PASTE_SESSION_TOKEN_HERE>" `
  -CsvPath ".\qa\fixtures\product-import-smoke.csv"
```

The script will:

- POST the CSV to `/api/products/csv/import`
- save the response JSON to `.\qa\artifacts\product-import-response.json`
- print `importId`, `spreadsheetFileId`, and `reused`

## 5. Expected First-Run Response

Expected shape:

```json
{
  "success": true,
  "message": "CSV import queued successfully",
  "importId": "<history-id>",
  "spreadsheetFileId": "<spreadsheet-id or null>",
  "reused": false,
  "data": {
    "editHistoryId": "<history-id>"
  }
}
```

Important checks:

- `success` is `true`
- `importId` is present
- `reused` is `false`
- no raw internal error message is exposed

## 6. Frontend Verification

In the embedded app:

1. Go to the spreadsheet import page.
2. Upload the same CSV manually through the UI.
3. Confirm the UI shows a success banner.
4. Confirm the app navigates to `/editDetails/:importId`.
5. Confirm the edit details page loads and does not crash.

The current UI consumer is [Spreadsheet.jsx](C:\Users\Venugopal K J\Downloads\Neon-MetaMatrix-translate\Neon-MetaMatrix-translate\web\frontend\Domain\Spreadsheet\pages\Spreadsheet.jsx), and it relies on:

- `result.message`
- `result.importId`

## 7. Reused-Import Verification

Run the same script again without changing:

- CSV file
- column mappings
- shop

Expected duplicate kickoff response:

```json
{
  "success": true,
  "message": "An identical CSV import is already queued.",
  "importId": "<same active history id>",
  "reused": true
}
```

Important checks:

- `success` remains `true`
- `reused` is `true`
- the returned `importId` points to the already-active import
- a second active import history is not created

## 8. Validation Failure Checks

Test these failure cases:

### Missing `id` mapping

Change mappings so no column maps to `id`.

Expected:

- `400`
- safe message: `Product ID mapping is required.`

### Invalid `columnMappings` JSON

Pass malformed JSON in the script:

```powershell
-MappingsJson '{"Product ID":'
```

Expected:

- `400`
- safe message: `Column mappings must be valid JSON.`

### Active bulk operation conflict

Trigger an active bulk operation, then re-run the import.

Expected:

- `409`
- safe message: `Another bulk operation is already running.`

## 9. Backend Verification

After a successful first import kickoff, verify:

- one `EditHistory` row exists for the returned `importId`
- it is shop-scoped to the current shop
- `isSpreadsheetEdit` is `true`
- `executionState` is `queued` after enqueue
- one `SpreadsheetFile` row is attached to that history
- the queue has a single `bulk-import-edit` job for that history

After the duplicate run, verify:

- no second active import history was created for the same request
- no second spreadsheet import kickoff row was created for the same active request

## 10. Temp File Cleanup

Verify that temp files do not accumulate after:

- invalid mapping submission
- bulk-operation conflict
- queue enqueue failure
- worker completion

## 11. Pass Criteria

The flow passes if:

- first upload returns a valid `importId`
- UI navigates to `/editDetails/:importId`
- duplicate upload returns `reused: true`
- invalid payloads return safe validation errors
- no cross-route contract drift appears between manual UI upload and direct API upload
