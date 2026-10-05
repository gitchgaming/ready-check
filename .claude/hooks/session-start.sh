#!/bin/bash
# Claude Code cloud sessions start on the image's Node 22. Install the major
# version in .nvmrc (latest release, checksum-verified) into ~/.local, which
# precedes /opt/node22/bin on PATH, then install dependencies (this also
# generates the Prisma client). Cloud only; local machines and Codespaces
# manage their own Node.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
major=$(tr -dc '0-9' < .nvmrc)
bin="$HOME/.local/bin"

if ! "$bin/node" --version 2>/dev/null | grep -q "^v$major\."; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
  esac
  base="https://nodejs.org/dist/latest-v$major.x"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -o "node-v[0-9.]*-linux-$arch\.tar\.xz" "$tmp/SHASUMS256.txt" | head -n1)
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -)

  dest="$HOME/.local/${file%.tar.xz}"
  rm -rf "$dest"
  mkdir -p "$dest" "$bin"
  tar -xJf "$tmp/$file" -C "$dest" --strip-components=1
  for tool in node npm npx corepack; do
    ln -sf "$dest/bin/$tool" "$bin/$tool"
  done
fi

# Keep ~/.local/bin first even if a shell profile reorders PATH.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
export PATH="$bin:$PATH"

# Railway CLI for reading production status and logs (RAILWAY_TOKEN comes from
# the cloud environment). Kept out of package.json so the Docker image never
# carries it. Railway publishes no checksums, so the SHA-256 of each release
# tarball is pinned here; bump the version and both hashes together.
railway_version=5.63.1
if ! "$bin/railway" --version 2>/dev/null | grep -q " $railway_version\$"; then
  case "$(uname -m)" in
    x86_64)
      target=x86_64-unknown-linux-musl
      sha=cbb559de44cd304cf9d6598a4ea77575035a0e6e3215370bb3b105b8f48235cc ;;
    aarch64 | arm64)
      target=aarch64-unknown-linux-musl
      sha=6a43ab738a596bffbe0ea946a4a5d38321d78b3957b7be3b09b962256cb5a761 ;;
    *) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
  esac
  rtmp=$(mktemp -d)
  file="railway-v$railway_version-$target.tar.gz"
  curl -fsSL "https://github.com/railwayapp/cli/releases/download/v$railway_version/$file" -o "$rtmp/$file"
  echo "$sha  $rtmp/$file" | sha256sum -c --quiet -
  mkdir -p "$bin"
  tar -xzf "$rtmp/$file" -C "$rtmp" railway
  install -m 755 "$rtmp/railway" "$bin/railway"
  rm -rf "$rtmp"
fi
echo "Using $(railway --version)"

echo "Using node $(node --version), npm $(npm --version)"
npm install --no-audit --no-fund
