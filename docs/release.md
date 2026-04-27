# Release and Homebrew Distribution

Kite ships macOS as a signed, notarized universal DMG attached to a GitHub release. Homebrew installs that DMG through the `rootsec1/homebrew-kite` tap.

## Required Apple Setup

Create these GitHub Actions secrets in `rootsec1/kite`:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`.
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`.
- `APPLE_API_ISSUER`: App Store Connect API issuer ID.
- `APPLE_API_KEY`: App Store Connect API key ID.
- `APPLE_API_KEY_PRIVATE_KEY`: contents of `AuthKey_<key>.p8`.
- `APPLE_SIGNING_IDENTITY`: optional; Tauri can infer it from `APPLE_CERTIFICATE`.

Tauri uses these values for code signing and notarization. A paid Apple Developer account is required for notarization.

## Required Homebrew Setup

Create a public tap repository:

```bash
gh repo create rootsec1/homebrew-kite --public
```

Create `HOMEBREW_TAP_TOKEN` in `rootsec1/kite` with `contents:write` access to `rootsec1/homebrew-kite`.

The release workflow writes `Casks/kite.rb` in that tap. Users install Kite with:

```bash
brew tap rootsec1/kite
brew install --cask kite
```

## Release

1. Update `package.json` and `src-tauri/tauri.conf.json` to the release version.
2. Commit the version change.
3. Tag and push:

```bash
git tag v0.1.0
git push origin main v0.1.0
```

The `Release` workflow will:

1. Build a universal macOS DMG.
2. Sign and notarize the app.
3. Publish `Kite_<version>_universal.dmg`, checksums, and `kite.rb` to GitHub Releases.
4. Update the Homebrew tap when `HOMEBREW_TAP_TOKEN` is configured.

## Local Checks

```bash
bun run build
cd src-tauri && cargo check --locked
```

To dry-run cask generation:

```bash
bun scripts/generate-homebrew-cask.mjs \
  --version 0.1.0 \
  --sha256 0000000000000000000000000000000000000000000000000000000000000000 \
  --url https://github.com/rootsec1/kite/releases/download/v0.1.0/Kite_0.1.0_universal.dmg \
  --output /tmp/kite.rb
```
