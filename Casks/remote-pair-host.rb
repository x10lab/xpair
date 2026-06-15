cask "remote-pair-host" do
  version "0.5.0"
  sha256 "26964e83ef0a4a8008e483c17beca5867b619e6853b884fa274ae4d342b4c958"

  url "https://github.com/ghyeongl/remote-pair/releases/download/v#{version}/RemotePairHost-#{version}.zip"
  name "RemotePairHost"
  desc "Menu-bar host for remote pairing with Claude (tmux + approve + sessions)"
  homepage "https://github.com/ghyeongl/remote-pair"

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
