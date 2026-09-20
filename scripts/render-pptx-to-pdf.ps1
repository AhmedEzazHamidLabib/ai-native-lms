# Converts a PPTX to PDF via local PowerPoint COM automation.
# See docs/COURSEWORK_LEARNING_ARCHITECTURE.md "PRESENTATIONS" — this
# is a one-time, per-material-version render, not a runtime dependency.
# No Docker/LibreOffice/cloud API introduced; PowerPoint is already
# installed on this machine.
#
# Usage: powershell -File scripts/render-pptx-to-pdf.ps1 -InputPath <pptx> -OutputPath <pdf>

param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$InputPath = (Resolve-Path $InputPath).Path
$OutputDir = Split-Path -Parent $OutputPath
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

$ppt = New-Object -ComObject PowerPoint.Application
try {
  # msoFalse = don't show the PowerPoint window
  $presentation = $ppt.Presentations.Open($InputPath, $null, $null, [Microsoft.Office.Core.MsoTriState]::msoFalse)
  # ppFixedFormatTypePDF=2, ppFixedFormatIntentPrint=2 (higher quality than Screen=1),
  # ppFrameSlideAll=1, ppPrintHandoutAll... using positional args with explicit
  # values for every parameter PowerShell's COM late-binding requires.
  $presentation.SaveAs($OutputPath, 32) # ppSaveAsPDF = 32 — simpler, reliable path via SaveAs
  $presentation.Close()
  Write-Output "Rendered: $OutputPath"
} finally {
  $ppt.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
