[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gpgCommand = Get-Command gpg -ErrorAction SilentlyContinue
$gpgPath = if ($gpgCommand) { $gpgCommand.Source } else { Join-Path $env:ProgramFiles 'Git/usr/bin/gpg.exe' }
if (-not (Test-Path -LiteralPath $gpgPath)) {
    throw 'Install GnuPG or Git for Windows before packaging the environment.'
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw 'tar is required to package the two files.'
}
foreach ($name in @('.env', '.dev.vars')) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $name) -PathType Leaf)) {
        throw "Missing required file: $name"
    }
}

$bundleDirectory = Join-Path $repoRoot ('.local/env-share/' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $bundleDirectory -Force | Out-Null
$archivePath = Join-Path $bundleDirectory 'coursay-env.tar'
$encryptedPath = "$archivePath.gpg"
$encodedPath = "$encryptedPath.base64"
try {
    & tar -cf $archivePath -C $repoRoot -- .env .dev.vars
    if ($LASTEXITCODE -ne 0) { throw 'Could not package the environment files.' }

    Write-Host 'Choose a passphrase in the GnuPG prompt. Share it separately with intended recipients.'
    & $gpgPath --no-symkey-cache --symmetric --cipher-algo AES256 --output $encryptedPath $archivePath
    if ($LASTEXITCODE -ne 0) { throw 'Encryption failed; no upload payload was created.' }

    $encoded = [Convert]::ToBase64String([IO.File]::ReadAllBytes($encryptedPath))
    # GitHub Actions secrets have a documented 48 KB per-secret limit.
    if ([Text.Encoding]::ASCII.GetByteCount($encoded) -gt 48KB) {
        throw 'Encrypted payload exceeds GitHub''s 48 KB secret limit. Do not upload this payload as a secret.'
    }
    [IO.File]::WriteAllText($encodedPath, $encoded, [Text.Encoding]::ASCII)
    Write-Host "Encrypted upload payload: $encodedPath"
    Write-Host 'Store this file as the ENV_BUNDLE_GPG_BASE64 Actions secret. Do not store the passphrase in GitHub.'
} finally {
    # Delete only the plaintext archive created by this invocation.
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
}
