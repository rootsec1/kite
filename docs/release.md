# Release and Homebrew Distribution

Kite ships macOS as an unsigned universal DMG attached to a GitHub release. Homebrew installs that DMG through the `rootsec1/homebrew-kite` tap.

The app is not notarized today. macOS may show an unidentified developer warning on first launch. Users can still open it with right-click > Open, or from System Settings > Privacy & Security > Open Anyway.

## Install

```bash
brew tap rootsec1/kite
brew install --cask kite
```

The current public release is `v0.1.3`:

- GitHub release: `https://github.com/rootsec1/kite/releases/tag/v0.1.3`
- Homebrew tap cask: `https://github.com/rootsec1/homebrew-kite/blob/main/Casks/kite.rb`

## Required Setup

Create the public tap repository once:

```bash
gh repo create rootsec1/homebrew-kite --public
```

Create `HOMEBREW_TAP_TOKEN` in `rootsec1/kite` with `contents:write` access to `rootsec1/homebrew-kite`. This can be a fine-grained GitHub token scoped to only the tap repository.

The token setup is intentionally split this way:

- Token repository access: `rootsec1/homebrew-kite`
- Secret location: `rootsec1/kite`

The release workflow runs from `rootsec1/kite`, builds the app, then uses `HOMEBREW_TAP_TOKEN` to push the generated cask into `rootsec1/homebrew-kite`.

Fine-grained token settings:

1. Open GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens.
2. Set Repository access to Only select repositories.
3. Select `rootsec1/homebrew-kite`.
4. Add Repository permissions > Contents > Read and write.
5. Generate the token and store it as the `HOMEBREW_TAP_TOKEN` Actions secret on `rootsec1/kite`.

If the token is exported in your shell, store it without printing it:

```bash
printf %s "$HOMEBREW_TAP_TOKEN" | gh secret set HOMEBREW_TAP_TOKEN --repo rootsec1/kite
```

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
git tag v0.1.3
git push origin main v0.1.3
```

The `Release` workflow will:

1. Build a universal macOS DMG.
2. Publish `Kite_<version>_universal.dmg`, checksums, and `kite.rb` to GitHub Releases.
3. Update the Homebrew tap when `HOMEBREW_TAP_TOKEN` is configured.

No Apple Developer account, signing certificate, App Store Connect key, or notarization secret is required for this flow.

## Official Homebrew Cask Status

Kite is not ready for `Homebrew/homebrew-cask` yet. The official audit currently blocks it for:

- Gatekeeper signature verification failure because the app is unsigned.
- GitHub notability below Homebrew's threshold for new casks.

The custom tap remains the correct distribution path until both are fixed. To prepare an official cask PR:

1. Sign and notarize the macOS app with a Developer ID certificate.
2. Build public adoption until the repository passes Homebrew's notability audit.
3. Run:

```bash
brew audit --cask --new rootsec1/kite/kite
```

4. Submit to `Homebrew/homebrew-cask` only after the audit passes.

## Verify Release

```bash
gh run list --repo rootsec1/kite --workflow Release --limit 3
gh release view v0.1.3 --repo rootsec1/kite
gh api repos/rootsec1/homebrew-kite/contents/Casks/kite.rb --jq '.content' | base64 --decode
```

## Local Checks

```bash
bun run build
cd src-tauri && cargo check --locked
```

To dry-run cask generation:

```bash
bun scripts/generate-homebrew-cask.mjs \
  --version 0.1.3 \
  --sha256 0000000000000000000000000000000000000000000000000000000000000000 \
  --url https://github.com/rootsec1/kite/releases/download/v0.1.3/Kite_0.1.3_universal.dmg \
  --output /tmp/kite.rb
```
