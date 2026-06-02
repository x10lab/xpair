#!/bin/bash
# make-signing-cert.sh — RemotePair 안정 코드서명용 self-signed cert 생성 (login keychain).
#
# 왜 필요: ad-hoc 서명은 재빌드마다 cdhash 가 바뀌어 TCC(손쉬운사용/화면기록) grant 가 무효화 → 매번 재토글.
#   안정 cert 로 서명하면 TCC grant 가 designated requirement(= bundle id + cert leaf hash)에 묶여
#   같은 cert 로 재빌드해도 grant 가 유지된다. (Apple Developer 계정/공증 불필요 — 본인 기기 전용.)
#
# 핵심: 단순 import 만으로는 codesign 이 errSecInternalComponent → codeSigning 용 TRUST 설정이 필요.
#   (add-trusted-cert -p codeSign). 이게 빠지면 'ambiguous'/'internal error' 로 실패.
#
# idempotent: 이미 있으면 재생성 안 함(중복 cert = 'ambiguous' 서명 실패 유발하므로).
# 다른 기기에서도 같은 grant 정체성을 쓰려면 이 스크립트로 새로 만들지 말고, 백업된 p12 를 import 할 것:
#   security import remote-pair-signing.p12 -k ~/Library/Keychains/login.keychain-db -P <pw> -T /usr/bin/codesign -A
set -euo pipefail
CN="RemotePair Local Signing"
KC=~/Library/Keychains/login.keychain-db
BACKUP="$HOME/Library/Application Support/RemotePair/signing.p12"   # git 밖 백업

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$CN"; then
  echo "이미 존재: $(security find-identity -v -p codesigning | grep "$CN")"
  echo "(재생성 안 함 — 중복 cert 는 'ambiguous' 서명 실패를 일으킴)"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
echo "=== cert+key 생성 (codeSigning EKU) ==="
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/CN=${CN}" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -addext "basicConstraints=critical,CA:false" 2>/dev/null
openssl pkcs12 -export -legacy -out id.p12 -inkey key.pem -in cert.pem -passout pass:rp 2>/dev/null

echo "=== import + codeSigning TRUST (핵심) ==="
security import id.p12 -k "$KC" -P rp -T /usr/bin/codesign -A
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" cert.pem

echo "=== 검증 ==="
security find-identity -v -p codesigning | grep "$CN"
echo 'int main(){return 0;}' > t.c && clang -o t t.c
codesign -s "$CN" --force --timestamp=none t && codesign --verify --strict t && echo "서명 테스트 OK ✓"

echo "=== p12 백업 (git 밖) ==="
mkdir -p "$(dirname "$BACKUP")"
cp id.p12 "$BACKUP"
echo "백업: $BACKUP (pass: rp) — 다른 빌드 기기에서 import 하면 동일 grant 정체성 사용 가능"
