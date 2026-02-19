// pack-xpi.cjs - Create a proper ZIP-format XPI for Zotero
// Uses .NET via PowerShell and forces forward-slash ZIP entry names.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const addonDir = path.resolve(__dirname, 'build', 'addon');
const xpiFile = path.resolve(__dirname, 'zoclau.xpi');
const zipFile = path.resolve(__dirname, 'zoclau_temp.zip');

// Clean up
if (fs.existsSync(xpiFile)) fs.unlinkSync(xpiFile);
if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile);

// Build ZIP in PowerShell so we can enforce "/" as entry separators.
const sourceDir = addonDir.replace(/'/g, "''");
const outputZip = zipFile.replace(/'/g, "''");
const psScript = `
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceDir = '${sourceDir}'
$zipPath = '${outputZip}'

$zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
try {
  $archive = New-Object System.IO.Compression.ZipArchive(
    $zipStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )

  try {
    Get-ChildItem -LiteralPath $sourceDir -Recurse -File | ForEach-Object {
      $fullPath = $_.FullName
      $relativePath = $fullPath.Substring($sourceDir.Length).TrimStart('\\', '/')
      $entryName = $relativePath.Replace('\\', '/')

      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $fullPath,
        $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
} finally {
  $zipStream.Dispose()
}
`;

try {
    execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
        stdio: 'inherit',
    });
} catch (e) {
    console.error('PowerShell ZIP failed:', e.message);
    process.exit(1);
}

// Rename .zip to .xpi
fs.renameSync(zipFile, xpiFile);

// Verify
const stats = fs.statSync(xpiFile);
const header = Buffer.alloc(2);
const fd = fs.openSync(xpiFile, 'r');
fs.readSync(fd, header, 0, 2, 0);
fs.closeSync(fd);

console.log(`Created: ${xpiFile}`);
console.log(`Size: ${stats.size} bytes`);
console.log(`ZIP magic: ${header.toString('ascii')} (expected: PK)`);
