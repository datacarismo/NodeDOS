#!/usr/bin/env bash
set -euo pipefail

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ISO_DIR="$PROJ_ROOT/iso"
OVERLAY="$ISO_DIR/overlay"
OUTPUT="$PROJ_ROOT/nodedos.iso"

# ── 1. Check dependencies ─────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1 — $2"; exit 1; }; }
need node        "install Node.js >= 18"
need npx         "install Node.js >= 18"
need grub-mkrescue "sudo apt install grub-pc-bin grub-efi-amd64-bin xorriso"
echo "[build] Dependencies OK"

# ── 2. Build TypeScript packages ──────────────────────────────────────────────
echo "[build] Compiling TypeScript..."
cd "$PROJ_ROOT" && npm run build

# ── 3. Bundle NodeDOS into a single CJS file ──────────────────────────────────
# The init script requires NodeDOSServer, PosixDriver, and startShell from one file.
echo "[build] Bundling NodeDOS..."
mkdir -p "$OVERLAY/nodedos"

# Use a temp entry file with absolute paths so esbuild resolves correctly
BUNDLE_ENTRY="$(mktemp /tmp/nodedos-bundle-entry-XXXX.js)"
cat > "$BUNDLE_ENTRY" <<EOF
const { NodeDOSServer } = require('$PROJ_ROOT/packages/server/dist/index.js');
const { PosixDriver }   = require('$PROJ_ROOT/packages/fs-drivers/dist/index.js');
const { startShell }    = require('$PROJ_ROOT/packages/shell/dist/index.js');
module.exports = { NodeDOSServer, PosixDriver, startShell };
EOF

npx esbuild "$BUNDLE_ENTRY" \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$OVERLAY/nodedos/bundle.js" \
  --external:net \
  --external:fs \
  --external:path \
  --external:os \
  --external:readline \
  --external:buffer \
  --external:events \
  --external:stream \
  --external:util \
  --external:tty

rm "$BUNDLE_ENTRY"

# Copy init script
cp "$PROJ_ROOT/init/index.js" "$OVERLAY/nodedos/init.js"
echo "[build] Bundle ready: $(du -sh "$OVERLAY/nodedos/bundle.js" | cut -f1)"

# ── 4. Check for Buildroot ────────────────────────────────────────────────────
BUILDROOT="${BUILDROOT_DIR:-$HOME/buildroot}"

if [ ! -d "$BUILDROOT" ]; then
  echo ""
  echo "[build] Buildroot not found at $BUILDROOT"
  echo "        Download it: https://buildroot.org/downloads/buildroot-2024.02.tar.gz"
  echo "        Then extract to $BUILDROOT and re-run this script."
  echo ""
  echo "        To test with an existing kernel+rootfs, run:"
  echo "          qemu-system-x86_64 -cdrom nodedos.iso -m 256M -nographic"
  exit 1
fi

# ── 5. Build kernel + rootfs with Buildroot ───────────────────────────────────
echo "[build] Running Buildroot (this takes 30–90 min on first run)..."
cp "$ISO_DIR/nodedos_defconfig" "$BUILDROOT/configs/nodedos_defconfig"

cd "$BUILDROOT"
make nodedos_defconfig
make -j"$(nproc)"

KERNEL="$BUILDROOT/output/images/bzImage"
ROOTFS="$BUILDROOT/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "Kernel not found at $KERNEL"; exit 1; }
[ -f "$ROOTFS" ] || { echo "Rootfs not found at $ROOTFS"; exit 1; }

# ── 6. Assemble ISO with GRUB ─────────────────────────────────────────────────
echo "[build] Assembling ISO..."
ISOROOT="$(mktemp -d)"
trap 'rm -rf "$ISOROOT"' EXIT

mkdir -p "$ISOROOT/boot/grub"
cp "$KERNEL" "$ISOROOT/boot/bzImage"
cp "$ROOTFS" "$ISOROOT/boot/rootfs.cpio.gz"
cp "$ISO_DIR/grub.cfg" "$ISOROOT/boot/grub/grub.cfg"

grub-mkrescue -o "$OUTPUT" "$ISOROOT" 2>/dev/null
echo ""
echo "[build] Done: $OUTPUT ($(du -sh "$OUTPUT" | cut -f1))"
echo ""
echo "  Test in QEMU:"
echo "    qemu-system-x86_64 -cdrom nodedos.iso -m 256M"
echo "  Write to USB (replace /dev/sdX):"
echo "    sudo dd if=nodedos.iso of=/dev/sdX bs=4M status=progress && sync"
