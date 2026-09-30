# Share the development environment

The **Share development environment** GitHub Actions workflow distributes an
encrypted archive containing both `.env` and `.dev.vars`. The maintainer encrypts
the files locally. GitHub stores and publishes ciphertext; it never receives the
passphrase or a readable archive through this process.

## Maintainer setup

1. Put the intended development configuration in the repository-root `.env` and
   `.dev.vars`. Review them locally before sharing: every recipient receives both
   files and all credentials they contain. These files remain ignored by Git.
2. Install GnuPG (Git for Windows includes it) and run from the repository root:

   ```powershell
   powershell -File scripts/package-development-env.ps1
   ```

   GnuPG prompts for a passphrase. Use a password manager to generate and share it
   with the intended recipients. Do not put it in a workflow input, GitHub secret,
   issue, or source file. The script prints only the path of the encrypted upload
   payload in the ignored `.local/env-share/` directory. It removes its temporary
   plaintext archive even if encryption fails.
3. In **Settings → Secrets and variables → Actions**, create a repository secret
   named `ENV_BUNDLE_GPG_BASE64` with the contents of the generated `.base64` file.
   Alternatively, with the official GitHub CLI authenticated:

   ```powershell
   Get-Content -Raw -LiteralPath '<generated .base64 file path>' |
     gh secret set ENV_BUNDLE_GPG_BASE64 --repo ai-interviewer-platform/ai-interviewer
   ```

4. Commit and push `.github/workflows/share-development-env.yml` to the default
   branch along with this guide and the packaging script. In **Actions → Share
   development environment → Run workflow**, select the default branch and run it.

An organization Actions secret can be used instead, with repository access granted
to this repository. Organization membership alone does not grant artifact access.
Collaborators with repository read access can download the artifact; someone with
write access must trigger the manual workflow. They still need the separately
shared passphrase to read the files.

## Teammate retrieval

1. Open the completed workflow run and download `coursay-development-env` under
   **Artifacts**. Extract the downloaded ZIP into a staging folder, separate from
   your checkout. It contains `coursay-env.tar.gpg`.
2. Obtain the passphrase from the maintainer through the password manager. In the
   staging folder, decrypt and unpack:

   ```powershell
   # If gpg is not on PATH with Git for Windows:
   $gpg = 'C:/Program Files/Git/usr/bin/gpg.exe'
   & $gpg --output coursay-env.tar --decrypt coursay-env.tar.gpg
   if ($LASTEXITCODE -ne 0) { throw 'Decryption failed.' }
   tar -xf coursay-env.tar
   if ($LASTEXITCODE -ne 0) { throw 'Extraction failed.' }
   Remove-Item -LiteralPath coursay-env.tar
   ```

   On macOS/Linux, use `gpg --output coursay-env.tar --decrypt coursay-env.tar.gpg`,
   then `tar -xf coursay-env.tar` and `rm -- coursay-env.tar` after successful
   decryption and extraction.
3. Review the extracted `.env` and `.dev.vars`, back up your existing local files,
   and copy them into your checkout. Keep local database URLs and other
   machine-specific values appropriate to your setup. Receiving these files does
   not provision a database; follow the README's local-development instructions.
   Remove unneeded plaintext copies from the staging folder afterward.

## Updating or ending access

Re-run the packaging command when the shared configuration changes, replace the
Actions secret, and run the workflow again. Existing artifacts are snapshots;
they do not update when the secret changes. Artifact expiration uses the repo's
configured retention policy, with no workflow override.

Delete outdated workflow artifacts when appropriate. Removing repository access,
deleting an artifact, or changing the bundle passphrase cannot revoke credentials
already downloaded. Rotate the underlying credentials if a recipient should no
longer have access.

## Constraints and references

- The workflow is manual, runs only on the default branch, checks out no code, and
  grants no `GITHUB_TOKEN` permissions. It uploads only the named encrypted file.
- GitHub limits individual Actions secrets to **48 KB**. The script checks the
  encoded payload against that platform limit and fails without uploading if it
  is exceeded. See [GitHub secrets limits](https://docs.github.com/en/actions/reference/security/secrets).
- Artifact access and expiration follow [GitHub artifact rules](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).
- Encryption uses [GnuPG symmetric encryption](https://gnupg.org/documentation/manuals/gnupg/Operational-GPG-Commands.html)
  with AES-256 and GnuPG's passphrase derivation. Keep the passphrase outside GitHub.
