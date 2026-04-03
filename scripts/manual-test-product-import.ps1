param(
  [Parameter(Mandatory = $false)]
  [string]$ApiBaseUrl = "http://localhost:3000",

  [Parameter(Mandatory = $true)]
  [string]$SessionToken,

  [Parameter(Mandatory = $false)]
  [string]$CsvPath = ".\qa\fixtures\product-import-smoke.csv",

  [Parameter(Mandatory = $false)]
  [string]$MappingsJson = '{"Product ID":"id","Variant ID":"variant_id","Title":"title","Price":"price"}',

  [Parameter(Mandatory = $false)]
  [string]$OutputPath = ".\qa\artifacts\product-import-response.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([string]$Path)

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
}

function Write-Section {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message =="
}

$resolvedCsvPath = Resolve-Path $CsvPath
Ensure-Directory -Path $OutputPath

Write-Section "Uploading CSV"
Write-Host "API base URL: $ApiBaseUrl"
Write-Host "CSV path: $resolvedCsvPath"

$headers = @{
  Authorization = "Bearer $SessionToken"
}

$form = @{
  file = Get-Item $resolvedCsvPath
  columnMappings = $MappingsJson
}

$uri = "$($ApiBaseUrl.TrimEnd('/'))/api/products/csv/import"
$response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Form $form

$response | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8

Write-Section "Response"
$response | ConvertTo-Json -Depth 10

Write-Section "Checks"
if (-not $response.success) {
  throw "Import request did not succeed."
}

if (-not $response.importId) {
  throw "Response did not include importId."
}

Write-Host "Import id: $($response.importId)"
Write-Host "Reused: $($response.reused)"
Write-Host "Spreadsheet file id: $($response.spreadsheetFileId)"
Write-Host "Saved response to: $OutputPath"

Write-Section "Next"
Write-Host "Open /editDetails/$($response.importId) in the embedded app and verify the import history details render."
Write-Host "Run the same script again with the same CSV and mappings to verify reused=true on the duplicate kickoff path."
