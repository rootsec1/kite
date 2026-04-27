#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const options = parseArgs(process.argv.slice(2));
const version = requiredOption(options, "version");
const sha256 = requiredOption(options, "sha256");
const url = requiredOption(options, "url");
const output = options.output ?? "packaging/homebrew/Casks/kite.rb";

const cask = `cask "kite" do
  version "${version}"
  sha256 "${sha256}"

  url "${url}"
  name "Kite"
  desc "Native Kubernetes cockpit"
  homepage "https://github.com/rootsec1/kite"

  depends_on macos: ">= :monterey"

  app "Kite.app"

  caveats <<~EOS
    Kite is unsigned and not notarized. macOS may block the first launch with
    an unidentified developer warning.

    To open Kite, right-click Kite.app and choose Open, or use System Settings
    > Privacy & Security > Open Anyway after the first blocked launch.
  EOS

  zap trash: [
    "~/Library/Application Support/io.github.rootsec1.kite",
    "~/Library/Caches/io.github.rootsec1.kite",
    "~/Library/Preferences/io.github.rootsec1.kite.plist",
    "~/Library/Saved Application State/io.github.rootsec1.kite.savedState",
    "~/Library/WebKit/io.github.rootsec1.kite",
  ]
end
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, cask);
console.log(`Wrote ${output}`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requiredOption(options, key) {
  const value = options[key];
  if (!value) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}
