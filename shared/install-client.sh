#!/bin/bash
# install-client.sh — install the Xpair client app WITHOUT Homebrew.
#
# Download the (self-signed) Xpair.app from the latest release with the Xpair.zip client asset and
# strip the Gatekeeper quarantine so it launches. Homebrew users get the quarantine strip from the
# cask's postflight (Casks/xpair.rb); this is the no-Homebrew equivalent — pure curl + xattr.
#
#   curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/install-client.sh | bash
#
# By default it installs the latest STABLE release that includes Xpair.zip. If no stable release has
# that asset yet, it falls back to the newest alpha pre-release with a notice. To opt into the newest
# release with Xpair.zip directly, pass --prerelease:
#   curl -fsSL https://raw.githubusercontent.com/x10lab/xpair/main/shared/install-client.sh | bash -s -- --prerelease
#
# After it installs, open Xpair — first-run onboarding does the rest (CLI, SSH, engine, host app).
set -euo pipefail

REPO=x10lab/xpair
APP=Xpair.app
ASSET=Xpair.zip
PER_PAGE=30
MAX_RELEASE_PAGES=3

PRERELEASE=0
for arg in "$@"; do
  case "$arg" in
    --prerelease|--pre) PRERELEASE=1 ;;
    -h|--help) echo "usage: install-client.sh [--prerelease]"; exit 0 ;;
    *) echo "✗ unknown argument: $arg (use --prerelease)" >&2; exit 2 ;;
  esac
done

[ "$(uname -s)" = Darwin ] || { echo "✗ macOS only" >&2; exit 1; }
[ "$(uname -m)" = arm64 ]  || { echo "✗ Xpair ships arm64-only (Apple Silicon)" >&2; exit 1; }

api="https://api.github.com/repos/$REPO"

die() {
  echo "✗ $*" >&2
  exit 1
}

parse_release_rows() {
  awk '
    function string_value(line, key, value) {
      value = line
      sub(".*\"" key "\"[[:space:]]*:[[:space:]]*\"", "", value)
      sub("\".*", "", value)
      return value
    }
    /"tag_name"[[:space:]]*:/ {
      tag = string_value($0, "tag_name")
    }
    /"prerelease"[[:space:]]*:/ {
      pre = $0
      sub(".*\"prerelease\"[[:space:]]*:[[:space:]]*", "", pre)
      sub("[[:space:],].*", "", pre)
      if (tag != "" && (pre == "true" || pre == "false")) {
        printf "%s %s\n", tag, pre
        tag = ""
      }
    }
  ' "$1"
}

fetch_release_rows() {
  local rows_file=$1
  local page json_file page_rows first_char row_count

  : > "$rows_file"
  page=1
  while [ "$page" -le "$MAX_RELEASE_PAGES" ]; do
    json_file="$tmp/releases-page-$page.json"
    page_rows="$tmp/releases-page-$page.rows"

    if ! curl -fsSL -o "$json_file" "$api/releases?per_page=$PER_PAGE&page=$page"; then
      echo "✗ could not fetch release metadata from $api/releases (page $page)" >&2
      return 2
    fi

    first_char="$(sed -n '/[^[:space:]]/ { s/^[[:space:]]*//; s/^\(.\).*/\1/; p; q; }' "$json_file")"
    if [ "$first_char" != "[" ]; then
      echo "✗ GitHub releases endpoint returned an unexpected response" >&2
      return 2
    fi

    parse_release_rows "$json_file" > "$page_rows"
    cat "$page_rows" >> "$rows_file"

    row_count="$(wc -l < "$page_rows" | tr -d '[:space:]')"
    [ "$row_count" -lt "$PER_PAGE" ] && break
    page=$((page + 1))
  done
}

asset_url() {
  printf "https://github.com/%s/releases/download/%s/%s\n" "$REPO" "$1" "$ASSET"
}

asset_http_status() {
  local status

  status="$(curl -sSIL -o /dev/null -w "%{http_code}" "$(asset_url "$1")" 2>/dev/null || true)"
  [ -n "$status" ] || status=000
  printf "%s\n" "$status"
}

select_release_with_asset() {
  local rows_file=$1
  local channel=$2
  local candidate_tag candidate_prerelease status

  while read -r candidate_tag candidate_prerelease; do
    [ -n "${candidate_tag:-}" ] || continue
    if [ "$channel" = stable ] && [ "$candidate_prerelease" != false ]; then
      continue
    fi
    if [ "$channel" = prerelease ] && [ "$candidate_prerelease" != true ]; then
      continue
    fi

    status="$(asset_http_status "$candidate_tag")"
    case "$status" in
      2??)
        printf "%s %s\n" "$candidate_tag" "$candidate_prerelease"
        return 0
        ;;
      404)
        ;;
      000)
        echo "✗ could not verify $ASSET for $candidate_tag (network failure)" >&2
        return 2
        ;;
      *)
        echo "✗ could not verify $ASSET for $candidate_tag (HTTP $status)" >&2
        return 2
        ;;
    esac
  done < "$rows_file"

  return 1
}

verify_selected_asset() {
  local status

  status="$(asset_http_status "$1")"
  case "$status" in
    2??) return 0 ;;
    404) die "release $1 does not include $ASSET; aborting before download" ;;
    000) die "could not verify $ASSET for $1 before download (network failure)" ;;
    *) die "could not verify $ASSET for $1 before download (HTTP $status)" ;;
  esac
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
rows="$tmp/releases.rows"
fetch_release_rows "$rows" || exit $?
[ -s "$rows" ] || die "could not find any GitHub releases from $api/releases"

tag=""
release_prerelease=""
if [ "$PRERELEASE" = 0 ]; then
  if selected="$(select_release_with_asset "$rows" stable)"; then
    read -r tag release_prerelease <<EOF
$selected
EOF
    echo "→ installing the latest STABLE release with $ASSET ($tag); pass --prerelease for the newest alpha build" >&2
  else
    rc=$?
    [ "$rc" -eq 1 ] || exit "$rc"
    echo "→ no stable release currently includes $ASSET — falling back to the latest pre-release with $ASSET" >&2
  fi
fi
if [ -z "$tag" ]; then
  if selected="$(select_release_with_asset "$rows" prerelease)"; then
    read -r tag release_prerelease <<EOF
$selected
EOF
    if [ "$PRERELEASE" = 0 ]; then
      echo "→ installing the latest pre-release ($tag); pass --prerelease to silence this" >&2
    elif [ "$release_prerelease" = true ]; then
      echo "→ installing the latest release with $ASSET ($tag, pre-release)" >&2
    else
      echo "→ installing the latest release with $ASSET ($tag)" >&2
    fi
  else
    rc=$?
    [ "$rc" -eq 1 ] || exit "$rc"
    die "could not find any release in the latest $((PER_PAGE * MAX_RELEASE_PAGES)) releases with $ASSET"
  fi
fi
verify_selected_asset "$tag"

# Test hook for CI/local checks: resolve and verify the asset without mutating /Applications.
if [ "${XPAIR_INSTALL_CLIENT_RESOLVE_ONLY:-0}" = 1 ]; then
  printf "%s\n" "$tag"
  exit 0
fi

# Install to /Applications, where the cask puts it. It is group-writable by `admin`, so an admin account
# (the macOS default) installs with NO sudo — same as `brew install --cask` or a drag-install. A standard
# (non-admin) account can't write /Applications for ANY app; that's a macOS rule, not ours, so fail fast
# with a clear message instead of escalating or dropping the app somewhere unexpected.
DEST=/Applications
[ -w "$DEST" ] || { echo "✗ $DEST isn't writable — installing an app there needs an admin account (no sudo required on one). Run this as an admin user, or drag Xpair.app in by hand." >&2; exit 1; }

echo "→ downloading Xpair $tag …"
curl -fsSL -o "$tmp/$ASSET" "$(asset_url "$tag")"

# Release zips are made with `ditto -c -k --keepParent`, so extract with ditto (preserves the bundle).
[ -d "${DEST:?}/${APP:?}" ] && rm -rf "${DEST:?}/${APP:?}"
/usr/bin/ditto -x -k "$tmp/$ASSET" "$DEST"
[ -d "$DEST/$APP" ] || { echo "✗ extraction did not produce $DEST/$APP" >&2; exit 1; }

# Strip the Gatekeeper quarantine so the self-signed app opens without the "unidentified developer"
# block — exactly what the Homebrew cask does in its postflight (brew's --no-quarantine equivalent).
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "✓ installed: $DEST/$APP ($tag)"
echo "  open it — first-run onboarding installs the CLI, wires SSH, and sets up the host."
