#!/bin/bash
# install_piper.sh — Download Piper TTS binary + voice model
# Sovereign voice for Anubis. No cloud. Runs fully offline.
# Run from repo root: bash scripts/install_piper.sh

set -e

PIPER_DIR="$(pwd)/data/piper"
ARCH=$(uname -m)

mkdir -p "$PIPER_DIR"
cd "$PIPER_DIR"

echo "🔱 Installing Piper TTS — sovereign voice layer"
echo "   Target: $PIPER_DIR"
echo "   Arch:   $ARCH"

# ── Piper binary ──────────────────────────────────────────────────────────
PIPER_VERSION="1.2.0"

case "$ARCH" in
  aarch64|arm64)
    PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_aarch64.tar.gz"
    ;;
  x86_64)
    PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz"
    ;;
  *)
    echo "❌ Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

echo "Downloading Piper binary..."
curl -L "$PIPER_URL" -o piper.tar.gz
tar -xzf piper.tar.gz
rm piper.tar.gz

# The binary lands in a piper/ subfolder — flatten it
if [ -f piper/piper ]; then
  mv piper/piper ./piper_bin
  rm -rf piper/
  mv piper_bin piper
fi

chmod +x piper
echo "✅ Piper binary installed: $PIPER_DIR/piper"

# ── Voice model — en_US-lessac-medium (Charon-adjacent: deep, resonant) ──
MODEL="en_US-lessac-medium"
MODEL_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${MODEL}.onnx"
CONFIG_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${MODEL}.onnx.json"

echo "Downloading voice model: ${MODEL}..."
curl -L "$MODEL_URL"    -o "${MODEL}.onnx"
curl -L "$CONFIG_URL"   -o "${MODEL}.onnx.json"
echo "✅ Voice model installed: $MODEL"

# ── Test ──────────────────────────────────────────────────────────────────
echo ""
echo "Testing Piper..."
echo "I have walked beside every soul that ever lived." | ./piper \
  --model "${MODEL}.onnx" \
  --output_file test_output.wav 2>/dev/null && \
  echo "✅ Piper test passed — test_output.wav written" || \
  echo "⚠️  Test failed — check dependencies"

echo ""
echo "🔱 Piper installation complete."
echo "   Run 'npm run voice' to activate sovereign voice."
