cask "remote-pair-host" do
  version "0.5.0a12" # release-pinned (NOT the dev shared/.build-counter, which bumps per build); bump when cutting a release
  sha256 :no_check # alpha pre-release (0.5.0aN); sha re-pinned at release time

  url "https://github.com/x10lab/xpair/releases/download/v#{version}/RemotePairHost-#{version}.zip"
  name "RemotePairHost"
  desc "Menu-bar host for remote pairing with Claude (tmux + approve + sessions)"
  homepage "https://github.com/x10lab/xpair"

  depends_on macos: :ventura
  # The host bundles arm64-only binaries (app + screen sidecar + Swift helpers,
  # all built -target arm64-apple-macos13.0). Reject Intel explicitly instead of
  # failing silently at launch. (universal via lipo is a separate follow-up.)
  depends_on arch: :arm64

  # Self-signed (not notarized): strip quarantine so Gatekeeper allows launch and
  # TCC (Accessibility / Screen Recording) grants stick to the stable signing identity.
  # Homebrew quarantines downloads by default, so we remove it explicitly post-install.
  app "RemotePairHost.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/RemotePairHost.app"]
  end

  uninstall quit: "com.x10lab.remote-pair-host"

  zap trash: "~/.remote-pair"

  caveats <<~EOS
    RemotePairHost is self-signed (not notarized). After install you must grant,
    in System Settings → Privacy & Security:
      • Accessibility   → RemotePairHost  (ON)
      • Screen Recording → RemotePairHost (ON)
    These grants persist across updates as long as the signing identity is stable.
  EOS
end
