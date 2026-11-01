<#
.SYNOPSIS
    Zips a source folder into a date-stamped backup and keeps only the 7 newest backups.

.DESCRIPTION
    Backup.ps1 performs these steps:
      1. Validates that -Source exists and is a folder.
      2. Creates -Destination if it does not exist.
      3. Writes Backup-yyyy-MM-dd.zip (today's date) into -Destination. If a backup
         for today already exists, it is replaced.
      4. Keeps only the 7 newest Backup-*.zip files in -Destination. Ordering uses the
         date in the file name, then LastWriteTime as a tie-breaker. Older backups are deleted.
      5. Prints every step (archive size, each removed backup, final count kept) to the
         console and appends the same lines to backup.log inside -Destination.

    If -Destination lies inside -Source, the destination folder (including backup.log and
    any temporary archive) is excluded from the archive so the zip never includes itself.
    The archive is built in a temporary file and moved into place only after it completes.

    Exit codes: 0 = success, 1 = failure (details are printed and logged).

.PARAMETER Source
    Folder to back up. Must exist.

.PARAMETER Destination
    Folder that receives the backups. Created if missing.

.EXAMPLE
    PS> .\backup.ps1 -Source 'C:\Users\chris\Documents\Projects' -Destination 'D:\Backups'

    Creates D:\Backups\Backup-<today>.zip, removes any older backups beyond the 7 newest,
    and prints each step.

.EXAMPLE
    PS> .\backup.ps1 -Source 'C:\Work' -Destination 'C:\Work\_backups'

    Destination is inside Source, so _backups is excluded from the archive.

.NOTES
    Requires PowerShell 5.1 or later (uses System.IO.Compression.FileSystem).
#>
#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
$KeepCount = 7
$script:LogFile = $null
$tempPath = $null

function Write-Log {
    param([string]$Message)
    $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $Message
    Write-Host $line
    if ($script:LogFile) {
        Add-Content -LiteralPath $script:LogFile -Value $line
    }
}

function Format-Size {
    param([long]$Bytes)
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return "$Bytes bytes"
}

try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    # 1. Validate Source
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Source folder not found: $Source"
    }
    $srcFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Source).ProviderPath).TrimEnd('\')

    # 2. Resolve and create Destination
    $destFull = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\')

    if (-not (Test-Path -LiteralPath $destFull -PathType Container)) {
        New-Item -ItemType Directory -Path $destFull -Force | Out-Null
    }
    $script:LogFile = Join-Path $destFull 'backup.log'

    if ($destFull -ieq $srcFull) {
        throw 'Destination cannot be the same folder as Source.'
    }
    $destInsideSource = $destFull.StartsWith($srcFull + '\', [System.StringComparison]::OrdinalIgnoreCase)

    Write-Log "Source: $srcFull"
    Write-Log "Destination: $destFull"
    if ($destInsideSource) {
        Write-Log 'Destination is inside Source; excluding it from the archive.'
    }

    # 3. Build today's archive in a temp file, then move it into place
    $stamp      = Get-Date -Format 'yyyy-MM-dd'
    $finalPath  = Join-Path $destFull "Backup-$stamp.zip"
    $tempPath   = Join-Path $destFull ('.building-' + [guid]::NewGuid().ToString('N') + '.tmp')
    $excludePrefix = $destFull + '\'

    $files = @(Get-ChildItem -LiteralPath $srcFull -Recurse -File -Force |
        Where-Object { -not $_.FullName.StartsWith($excludePrefix, [System.StringComparison]::OrdinalIgnoreCase) })

    $zip = [System.IO.Compression.ZipFile]::Open($tempPath, [System.IO.Compression.ZipArchiveMode]::Create)
    $fileCount = 0
    foreach ($f in $files) {
        $entryName = $f.FullName.Substring($srcFull.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $f.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $fileCount++
    }
    $zip.Dispose()
    $zip = $null

    if (Test-Path -LiteralPath $finalPath) {
        Write-Log "Replacing existing backup for today: $(Split-Path $finalPath -Leaf)"
    }
    Move-Item -LiteralPath $tempPath -Destination $finalPath -Force
    $tempPath = $null

    $size = (Get-Item -LiteralPath $finalPath).Length
    Write-Log "Archive created: $finalPath ($(Format-Size $size), $fileCount file(s))"

    # 4. Rotation: keep only the newest $KeepCount Backup-yyyy-MM-dd.zip files
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    $dated = @()
    foreach ($b in Get-ChildItem -LiteralPath $destFull -Filter 'Backup-*.zip' -File) {
        $parsedDate = [datetime]::MinValue
        if ($b.BaseName -match '^Backup-(\d{4}-\d{2}-\d{2})$' -and
            [datetime]::TryParseExact($Matches[1], 'yyyy-MM-dd', $inv,
                [System.Globalization.DateTimeStyles]::None, [ref]$parsedDate)) {
            $dated += [pscustomobject]@{ File = $b; Date = $parsedDate }
        }
    }

    $ordered = @($dated | Sort-Object -Property @{Expression = 'Date'; Descending = $true},
                                              @{Expression = { $_.File.LastWriteTime }; Descending = $true})

    $removed = 0
    for ($i = $KeepCount; $i -lt $ordered.Count; $i++) {
        $old = $ordered[$i].File
        $oldSize = $old.Length
        Remove-Item -LiteralPath $old.FullName -Force
        $removed++
        Write-Log "Removed old backup: $($old.Name) ($(Format-Size $oldSize))"
    }

    $kept = [math]::Min($ordered.Count, $KeepCount)
    Write-Log "Final count kept: $kept of $KeepCount allowed backup(s); removed $removed."
    Write-Log 'Done.'
}
catch {
    $exitCode = 1
    Write-Log "ERROR: $($_.Exception.Message)"
}
finally {
    if ($zip) { $zip.Dispose() }
    if ($tempPath -and (Test-Path -LiteralPath $tempPath)) {
        Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
