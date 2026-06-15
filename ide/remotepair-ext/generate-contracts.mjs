#!/usr/bin/env node
// generate-contracts.mjs — generate ./generated/contracts.json from the monorepo shared/ SoT.
//
// Runs in the MONOREPO (where ../../shared exists). The OUTPUT is committed so the
// ide/ subtree stays self-contained: a standalone remotepair-ide build never reaches
// into ../../shared at build or runtime — it only consumes the committed generated file.
//
// Regenerate after changing shared/: `node ide/remotepair-ext/generate-contracts.mjs`
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "..", "..", "shared");
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));

const proto = rd(join(shared, "screen-protocol", "constants.json"));
const ident = rd(join(shared, "identity", "identity.json"));
const vers = rd(join(shared, "identity", "versions.json"));

const out = {
  _generated: "DO NOT EDIT — generated from monorepo shared/ by generate-contracts.mjs",
  screen: {
    v1aPort: proto.transport.v1a_jpeg.defaultPort,
    v2SignalPort: proto.transport.v2_webrtc.defaultSignalPort,
    inputThrottleMs: proto.input.throttleMs,
    reqFile: proto.input.reqFile,
    resFile: proto.input.resFile,
  },
  identity: {
    product: ident.product,
    urlProtocol: ident.urlProtocol,
    ideBundleId: ident.components.ide.darwinBundleIdentifier,
  },
  version: vers.ide,
};

mkdirSync(join(here, "generated"), { recursive: true });
writeFileSync(join(here, "generated", "contracts.json"), JSON.stringify(out, null, 2) + "\n");
console.log("✓ generated/contracts.json written from shared/ SoT");
