# Release and Homebrew Distribution

Kite ships macOS as an unsigned universal DMG attached to a GitHub release. Homebrew installs that DMG through the `rootsec1/homebrew-kite` tap.

The app is not notarized today. macOS may show an unidentified developer warning on first launch. Users can still open it with right-click > Open, or from System Settings > Privacy & Security > Open Anyway.

## Required Setup

Create a public tap repository:

```bash
gh repo create rootsec1/homebrew-kite --public
```

Create `HOMEBREW_TAP_TOKEN` in `rootsec1/kite` with `contents:write` access to `rootsec1/homebrew-kite`. This can be a fine-grained GitHub token scoped to the tap repository.

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
2. Publish `Kite_<version>_universal.dmg`, checksums, and `kite.rb` to GitHub Releases.
3. Update the Homebrew tap when `HOMEBREW_TAP_TOKEN` is configured.

No Apple Developer account, signing certificate, App Store Connect key, or notarization secret is required for this flow.

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
