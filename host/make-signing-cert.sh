#!/bin/bash
# make-signing-cert.sh — Creates a self-signed cert for stable Xpair code signing (login keychain).
#
# Why it's needed: ad-hoc signing changes the cdhash on every rebuild, which invalidates the TCC
#   (Accessibility / Screen Recording) grant → re-toggle every time.
#   Signing with a stable cert binds the TCC grant to the designated requirement (= bundle id + cert leaf hash),
#   so the grant persists across rebuilds with the same cert. (No Apple Developer account / notarization
#   required — for your own machine only.)
#
# Key point: a plain import alone makes codesign fail with errSecInternalComponent → a codeSigning TRUST
#   setting is required (add-trusted-cert -p codeSign). Without it, it fails with 'ambiguous'/'internal error'.
#
# idempotent: if it already exists, it is not regenerated (a duplicate cert = 'ambiguous' signing failure).
# To use the same grant identity on another machine, do not create a new one with this script; import the
# backed-up p12 instead:
#   security import xpair-signing.p12 -k ~/Library/Keychains/login.keychain-db -P <pw> -T /usr/bin/codesign -A
set -euo pipefail
CN="RemotePair Local Signing"
KC=~/Library/Keychains/login.keychain-db
BACKUP="$HOME/Library/Application Support/Xpair/signing.p12"   # backup outside git

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$CN"; then
  echo "Already exists: $(security find-identity -v -p codesigning | grep "$CN")"
  echo "(Not regenerating — a duplicate cert causes 'ambiguous' signing failures)"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
echo "=== Generating cert+key (codeSigning EKU) ==="
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/CN=${CN}" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -addext "basicConstraints=critical,CA:false" 2>/dev/null
openssl pkcs12 -export -legacy -out id.p12 -inkey key.pem -in cert.pem -passout pass:rp 2>/dev/null

echo "=== import + codeSigning TRUST (key step) ==="
security import id.p12 -k "$KC" -P rp -T /usr/bin/codesign -A
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" cert.pem

echo "=== Verifying ==="
security find-identity -v -p codesigning | grep "$CN"
echo 'int main(){return 0;}' > t.c && clang -o t t.c
codesign -s "$CN" --force --timestamp=none t && codesign --verify --strict t && echo "Signing test OK ✓"

echo "=== p12 backup (outside git) ==="
mkdir -p "$(dirname "$BACKUP")"
cp id.p12 "$BACKUP"
echo "Backup: $BACKUP (pass: rp) — importing it on another build machine lets you reuse the same grant identity"
