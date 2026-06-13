#!/usr/bin/env bash
#
# setup-engines.sh — download / build the chess engines Chesser uses.
#
#   * Stockfish  (download official Linux release binary)
#   * Maia       (download human-like Lc0 networks: 1100 / 1500 / 1900)
#   * Lc0        (build from source — required to run the Maia networks)
#
# Everything lands in   engines/bin/  and  engines/networks/  and a machine
# readable  engines/manifest.json  is written describing what succeeded.
#
# The backend reads that manifest at boot and only offers engines that exist,
# so a partial setup still yields a working app (Stockfish-only, say).
#
# Usage:
#   bash scripts/setup-engines.sh            # everything
#   SKIP_LC0=1 bash scripts/setup-engines.sh # Stockfish + Maia only (no build)
#   ONLY=stockfish bash scripts/setup-engines.sh
#
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINES_DIR="$ROOT_DIR/engines"
BIN_DIR="$ENGINES_DIR/bin"
NET_DIR="$ENGINES_DIR/networks"
SRC_DIR="$ENGINES_DIR/src"
mkdir -p "$BIN_DIR" "$NET_DIR" "$SRC_DIR"

SF_VERSION="${SF_VERSION:-sf_17.1}"
MAIA_RATINGS=("1100" "1500" "1900")

log()  { printf '\033[1;36m[engines]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*"; }

want() { # respect ONLY=foo filter
  [[ -z "${ONLY:-}" || "${ONLY}" == "$1" ]]
}

STOCKFISH_OK=0
LC0_OK=0
MAIA_NETS=()

# ---------------------------------------------------------------------------
# Stockfish — pick the fastest binary the CPU supports.
# ---------------------------------------------------------------------------
setup_stockfish() {
  want stockfish || return 0
  if [[ -x "$BIN_DIR/stockfish" ]] && "$BIN_DIR/stockfish" --help >/dev/null 2>&1; then
    ok "Stockfish already present"; STOCKFISH_OK=1; return 0
  fi
  local flags variant
  flags="$(grep -m1 flags /proc/cpuinfo || true)"
  if   [[ "$flags" == *avx512* ]]; then variant="x86-64-avx512"
  elif [[ "$flags" == *bmi2*   ]]; then variant="x86-64-bmi2"
  elif [[ "$flags" == *avx2*   ]]; then variant="x86-64-avx2"
  elif [[ "$flags" == *sse41*  || "$flags" == *sse4_1* ]]; then variant="x86-64-sse41-popcnt"
  else variant="x86-64"; fi

  local url="https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/stockfish-ubuntu-${variant}.tar"
  log "Downloading Stockfish ${SF_VERSION} (${variant})"
  if ! curl -fSL --retry 4 --retry-delay 2 -o "$ENGINES_DIR/sf.tar" "$url"; then
    warn "variant ${variant} unavailable, falling back to x86-64-avx2"
    url="https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/stockfish-ubuntu-x86-64-avx2.tar"
    curl -fSL --retry 4 --retry-delay 2 -o "$ENGINES_DIR/sf.tar" "$url" || { err "Stockfish download failed"; return 1; }
  fi
  tar -xf "$ENGINES_DIR/sf.tar" -C "$ENGINES_DIR"
  local found
  found="$(find "$ENGINES_DIR/stockfish" -maxdepth 1 -type f -name 'stockfish*' | head -1)"
  [[ -n "$found" ]] || { err "Stockfish binary not found in archive"; return 1; }
  cp "$found" "$BIN_DIR/stockfish"
  chmod +x "$BIN_DIR/stockfish"
  rm -rf "$ENGINES_DIR/sf.tar" "$ENGINES_DIR/stockfish"
  "$BIN_DIR/stockfish" --help >/dev/null 2>&1 || true
  ok "Stockfish ready -> engines/bin/stockfish"
  STOCKFISH_OK=1
}

# ---------------------------------------------------------------------------
# Maia networks — human-like Lc0 weights, one per rating band.
# ---------------------------------------------------------------------------
setup_maia() {
  want maia || want lc0 || return 0
  for r in "${MAIA_RATINGS[@]}"; do
    local out="$NET_DIR/maia-${r}.pb.gz"
    if [[ -s "$out" ]]; then ok "Maia ${r} already present"; MAIA_NETS+=("$r"); continue; fi
    local url="https://github.com/CSSLab/maia-chess/raw/master/maia_weights/maia-${r}.pb.gz"
    log "Downloading Maia ${r}"
    if curl -fSL --retry 4 --retry-delay 2 -o "$out" "$url"; then
      ok "Maia ${r} ready"; MAIA_NETS+=("$r")
    else
      warn "Maia ${r} download failed"; rm -f "$out"
    fi
  done
}

# ---------------------------------------------------------------------------
# Lc0 — build from source (no official Linux binaries are published).
# CPU build via the built-in Eigen backend (no GPU / BLAS needed).
# ---------------------------------------------------------------------------
setup_lc0() {
  want lc0 || return 0
  [[ "${SKIP_LC0:-0}" == "1" ]] && { warn "SKIP_LC0=1 — skipping Lc0 build"; return 0; }
  if [[ -x "$BIN_DIR/lc0" ]]; then ok "Lc0 already present"; LC0_OK=1; return 0; fi

  if ! command -v meson >/dev/null 2>&1; then
    log "Installing meson (pip)"
    pip install --quiet --user meson 2>/dev/null || pip3 install --quiet --user meson 2>/dev/null || true
    export PATH="$HOME/.local/bin:$PATH"
  fi
  command -v meson >/dev/null 2>&1 || { err "meson unavailable — cannot build Lc0"; return 1; }
  command -v ninja >/dev/null 2>&1 || { err "ninja unavailable — cannot build Lc0"; return 1; }

  # The CPU (blas) backend falls back to Eigen. Meson would normally download
  # Eigen as a wrap subproject, but the wrapdb patch host is often blocked, so
  # prefer a system Eigen if we can install one.
  if ! pkg-config --exists eigen3 2>/dev/null && [[ ! -d /usr/include/eigen3 ]]; then
    log "Installing Eigen headers (libeigen3-dev)"
    if command -v apt-get >/dev/null 2>&1; then
      (apt-get install -y libeigen3-dev >/dev/null 2>&1) \
        || (sudo apt-get install -y libeigen3-dev >/dev/null 2>&1) \
        || warn "could not install libeigen3-dev automatically — Lc0 build may fail"
    else
      warn "no apt-get; install Eigen headers manually if the Lc0 build fails"
    fi
  fi

  local lc0_src="$SRC_DIR/lc0"
  if [[ ! -d "$lc0_src/.git" ]]; then
    log "Cloning Lc0"
    git clone --depth 1 --recurse-submodules --shallow-submodules \
      https://github.com/LeelaChessZero/lc0.git "$lc0_src" || { err "Lc0 clone failed"; return 1; }
  fi
  log "Building Lc0 (CPU/Eigen backend — this takes several minutes)"
  (
    cd "$lc0_src" || exit 1
    rm -rf build/release
    CC=gcc CXX=g++ meson setup build/release --buildtype=release \
      -Dgtest=false -Dopencl=false -Dcudnn=false -Dplain_cuda=false \
      -Donednn=false -Ddnnl=false -Dmkl=false -Dopenblas=false \
      -Daccelerate=false -Dblas=true -Dispc=false -Dtensorflow=false \
      -Donnx=false -Dmetal=disabled -Ddx=false >/dev/null 2>&1 || exit 1
    ninja -C build/release >/dev/null 2>&1 || exit 1
  )
  if [[ -x "$lc0_src/build/release/lc0" ]]; then
    cp "$lc0_src/build/release/lc0" "$BIN_DIR/lc0"
    chmod +x "$BIN_DIR/lc0"
    ok "Lc0 ready -> engines/bin/lc0"
    LC0_OK=1
  else
    err "Lc0 build did not produce a binary"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Manifest — the backend's source of truth for what's installed.
# ---------------------------------------------------------------------------
write_manifest() {
  # Detect from disk so a filtered run (e.g. ONLY=lc0) never drops a previously
  # installed engine from the manifest.
  [[ -x "$BIN_DIR/stockfish" ]] && STOCKFISH_OK=1
  [[ -x "$BIN_DIR/lc0" ]] && LC0_OK=1
  local nets_json="" first=1
  for r in "${MAIA_RATINGS[@]}"; do
    [[ -s "$NET_DIR/maia-${r}.pb.gz" ]] || continue
    [[ $first -eq 0 ]] && nets_json+=","
    nets_json+="{\"id\":\"maia-${r}\",\"rating\":${r},\"path\":\"networks/maia-${r}.pb.gz\"}"
    first=0
  done
  cat > "$ENGINES_DIR/manifest.json" <<JSON
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "stockfish": $( [[ $STOCKFISH_OK -eq 1 ]] && echo "{\"path\":\"bin/stockfish\"}" || echo null ),
  "lc0": $( [[ $LC0_OK -eq 1 ]] && echo "{\"path\":\"bin/lc0\"}" || echo null ),
  "maiaNetworks": [${nets_json}]
}
JSON
  ok "Wrote engines/manifest.json"
}

log "Setting up engines in $ENGINES_DIR"
setup_stockfish || warn "Stockfish setup incomplete"
setup_maia      || warn "Maia setup incomplete"
setup_lc0       || warn "Lc0 setup incomplete"
write_manifest

echo
log "Summary:"
printf '  Stockfish : %s\n' "$([[ $STOCKFISH_OK -eq 1 ]] && echo available || echo MISSING)"
printf '  Lc0       : %s\n' "$([[ $LC0_OK -eq 1 ]] && echo available || echo 'missing (run without SKIP_LC0 to build)')"
printf '  Maia nets : %s\n' "$([[ ${#MAIA_NETS[@]} -gt 0 ]] && echo "${MAIA_NETS[*]}" || echo none)"
echo
[[ $STOCKFISH_OK -eq 1 ]] && exit 0 || exit 1
