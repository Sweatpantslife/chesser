#!/usr/bin/env bash
#
# setup-engines.sh — download / build the chess engines Chesser uses.
#
#   * Stockfish  (download official Linux release binary)
#   * Maia       (download human-like Lc0 networks: 1100 … 1900 in 100 steps)
#   * Lc0        (build from source — required to run the Maia networks)
#
# Everything lands in   engines/bin/  and  engines/networks/  and a machine
# readable  engines/manifest.json  is written describing what succeeded.
#
# The backend reads that manifest at boot and only offers engines that exist,
# so a partial setup still yields a working app (Stockfish-only, say).
#
# Downloads are verified against pinned SHA-256 checksums (see known_sha256
# below). REQUIRE_CHECKSUMS=1 turns "no checksum available" (e.g. a custom
# SF_VERSION without SF_SHA256) into a hard failure — the Docker build sets it.
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
SYZYGY_DIR="$ENGINES_DIR/syzygy"
mkdir -p "$BIN_DIR" "$NET_DIR" "$SRC_DIR"

SF_VERSION="${SF_VERSION:-sf_17.1}"
# Expected SHA-256 of the Stockfish tar when using a version/variant that is
# not in the pinned table below (the table only covers the default release).
SF_SHA256="${SF_SHA256:-}"
# 1 = refuse to install anything we cannot checksum-verify (set by the Docker
# build so images never ship unverified binaries). Default 0: warn only, so
# local experiments with other versions still work.
REQUIRE_CHECKSUMS="${REQUIRE_CHECKSUMS:-0}"
# The full CSSLab set: one net per 100-point band. Ladder personas map to the
# nearest net, so partial downloads still work (the server offers what exists).
MAIA_RATINGS=("1100" "1200" "1300" "1400" "1500" "1600" "1700" "1800" "1900")
# Maia weights are fetched from a pinned commit of CSSLab/maia-chess (immutable
# content) and verified against the checksums below. Bump commit + checksums together.
MAIA_COMMIT="${MAIA_COMMIT:-749204cf5979ce7f8b0412e804a4ee7c83c49ff8}"
# Optional tag/branch to pin the Lc0 source build (default: master, as before).
LC0_REF="${LC0_REF:-}"

# Syzygy tablebases (opt-in; the 3-4-5 set is ~1GB). Override the mirror/set if
# you have a faster or self-hosted source.
SYZYGY_BASE_URL="${SYZYGY_BASE_URL:-https://tablebase.lichess.ovh/tables/standard}"
SYZYGY_SET="${SYZYGY_SET:-3-4-5}"

log()  { printf '\033[1;36m[engines]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*"; }

want() { # respect ONLY=foo filter
  [[ -z "${ONLY:-}" || "${ONLY}" == "$1" ]]
}

STOCKFISH_OK=0
LC0_OK=0
SYZYGY_OK=0
MAIA_NETS=()

# ---------------------------------------------------------------------------
# Download integrity — pinned SHA-256 checksums for everything we fetch.
#
# Stockfish sf_17.1: hashes of the official release tars, computed 2026-07-11
# from the project's SourceForge mirror (sourceforge.net/projects/stockfish.mirror)
# and cross-checked against the md5 metadata SourceForge recorded at release
# time (2025-03-30); the shipped binary answers the UCI handshake as
# "Stockfish 17.1". They can be re-verified against the sha256 `digest` GitHub
# shows for each asset on the release page.
# Maia: computed from CSSLab/maia-chess @ 749204c (see MAIA_COMMIT above).
# ---------------------------------------------------------------------------
known_sha256() { # $1 = <release-tag>/<filename> or maia/<filename>; echoes hash or ""
  case "$1" in
    sf_17.1/stockfish-ubuntu-x86-64-avx512.tar)       echo "bf7c4758da532aee059fd2c2339c1c5e89a3c463471775018201fe14b6c62cc6" ;;
    sf_17.1/stockfish-ubuntu-x86-64-bmi2.tar)         echo "90143ce99bac92fcb834b18339d0990ae178428affa101ab7f00210fe6706335" ;;
    sf_17.1/stockfish-ubuntu-x86-64-avx2.tar)         echo "09e953222dbe80aaea5c33dab265413b295cb8376418445c877708c61e31987d" ;;
    sf_17.1/stockfish-ubuntu-x86-64-sse41-popcnt.tar) echo "bbbbcfed2b398ebda8139b37d5a7373d0d724aa9237814cb74a21643c4b63e9e" ;;
    sf_17.1/stockfish-ubuntu-x86-64.tar)              echo "4dafdd04f71e70755a327b5be258937b281e60ba87bc0a5801399908240d4a73" ;;
    maia/maia-1100.pb.gz) echo "e1cf1cd0c96b8a4fa6a275f4b9fd54ed1ffebf9fe44641b9fceded310e9619c4" ;;
    maia/maia-1200.pb.gz) echo "ead4ba953f233ae732999ebc1e2b675378148527ebcfad2f0acbc5e4c224d98e" ;;
    maia/maia-1300.pb.gz) echo "36195f87bf4761834baa0bf87472b18509a7261a9d7d6f1a8443261369a733f2" ;;
    maia/maia-1400.pb.gz) echo "d5353ea6766356dad2d28920c6692f37a5f30963767f1a3105d33b4d0af011e8" ;;
    maia/maia-1500.pb.gz) echo "35ab6f20421d59e1df3b17c5a5016947af4c6761368ef84044a9a9c7619a9a00" ;;
    maia/maia-1600.pb.gz) echo "d2c9e5948581acf4b9fc0b1e720c5dc0fe64ce80cfc4a239d3f8a42e1176c876" ;;
    maia/maia-1700.pb.gz) echo "d277eacd792d340a30abb464dc65127254e65cac57abca17facc469889b96478" ;;
    maia/maia-1800.pb.gz) echo "0031ad7c4256b1fd09fbebd28418d644d68b26cd2a45df4967ccf5c7ec9c4965" ;;
    maia/maia-1900.pb.gz) echo "e2f565f42d7cd9f122557e6dc4eb84e5bbaedceda1d404dc485d3611c7c97a12" ;;
    *) echo "" ;;
  esac
}

verify_sha256() { # $1 = file, $2 = expected hash, $3 = label. Removes $1 on mismatch.
  local actual
  # sha256sum on Linux; macOS ships `shasum` instead. Fail closed if neither
  # exists — never install an engine binary we couldn't checksum.
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$1" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$1" | awk '{print $1}')"
  else
    err "no sha256sum or shasum found — cannot verify $3"
    rm -f "$1"
    return 1
  fi
  if [[ "$actual" == "$2" ]]; then
    ok "checksum verified: $3"
    return 0
  fi
  err "checksum MISMATCH for $3 — refusing to install it"
  err "  expected: $2"
  err "  actual:   $actual"
  rm -f "$1"
  return 1
}

# ---------------------------------------------------------------------------
# Stockfish — pick the fastest binary the CPU supports.
# ---------------------------------------------------------------------------
setup_stockfish() {
  want stockfish || return 0
  if [[ -x "$BIN_DIR/stockfish" ]] && "$BIN_DIR/stockfish" --help >/dev/null 2>&1; then
    ok "Stockfish already present"; STOCKFISH_OK=1; return 0
  fi
  local flags variant
  # SF_VARIANT pins the binary explicitly — important for container images, where
  # the build host's CPU may differ from the deploy host's. Otherwise auto-detect
  # the fastest variant the *current* CPU supports.
  if [[ -n "${SF_VARIANT:-}" ]]; then
    variant="$SF_VARIANT"
  else
    flags="$(grep -m1 flags /proc/cpuinfo || true)"
    if   [[ "$flags" == *avx512* ]]; then variant="x86-64-avx512"
    elif [[ "$flags" == *bmi2*   ]]; then variant="x86-64-bmi2"
    elif [[ "$flags" == *avx2*   ]]; then variant="x86-64-avx2"
    elif [[ "$flags" == *sse41*  || "$flags" == *sse4_1* ]]; then variant="x86-64-sse41-popcnt"
    else variant="x86-64"; fi
  fi

  # Resolve the expected checksum before downloading: an explicit SF_SHA256
  # wins (needed for versions/variants outside the pinned table), else the
  # table. No checksum available → warn, or fail under REQUIRE_CHECKSUMS=1.
  local archive="stockfish-ubuntu-${variant}.tar"
  local expected="${SF_SHA256:-$(known_sha256 "$SF_VERSION/$archive")}"
  if [[ -z "$expected" ]]; then
    if [[ "$REQUIRE_CHECKSUMS" == "1" ]]; then
      err "no pinned SHA-256 for $SF_VERSION/$archive — set SF_SHA256 (REQUIRE_CHECKSUMS=1)"
      return 1
    fi
    warn "no pinned SHA-256 for $SF_VERSION/$archive — set SF_SHA256 to verify the download"
  fi

  local url="https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/${archive}"
  log "Downloading Stockfish ${SF_VERSION} (${variant})"
  if ! curl -fSL --retry 4 --retry-delay 2 -o "$ENGINES_DIR/sf.tar" "$url"; then
    warn "variant ${variant} unavailable, falling back to x86-64-avx2"
    archive="stockfish-ubuntu-x86-64-avx2.tar"
    # SF_SHA256 pins the *requested* file; the fallback is a different file,
    # so only the table can vouch for it.
    expected="$(known_sha256 "$SF_VERSION/$archive")"
    if [[ -z "$expected" && "$REQUIRE_CHECKSUMS" == "1" ]]; then
      err "no pinned SHA-256 for fallback $SF_VERSION/$archive (REQUIRE_CHECKSUMS=1)"
      return 1
    fi
    url="https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/${archive}"
    curl -fSL --retry 4 --retry-delay 2 -o "$ENGINES_DIR/sf.tar" "$url" || { err "Stockfish download failed"; return 1; }
  fi
  if [[ -n "$expected" ]]; then
    verify_sha256 "$ENGINES_DIR/sf.tar" "$expected" "$archive" || return 1
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
    local expected
    expected="$(known_sha256 "maia/maia-${r}.pb.gz")"
    if [[ -s "$out" ]]; then
      # Re-verify cached nets; a corrupt/tampered file is deleted and re-fetched.
      if verify_sha256 "$out" "$expected" "maia-${r}.pb.gz (cached)"; then
        ok "Maia ${r} already present"; MAIA_NETS+=("$r"); continue
      fi
      warn "cached Maia ${r} failed verification — re-downloading"
    fi
    # raw.githubusercontent.com is the redirect target of github.com/<repo>/raw/
    # and also works behind proxies that block github.com file paths. The commit
    # pin makes the content immutable; the checksum makes it verified.
    local url="https://raw.githubusercontent.com/CSSLab/maia-chess/${MAIA_COMMIT}/maia_weights/maia-${r}.pb.gz"
    log "Downloading Maia ${r}"
    if ! curl -fSL --retry 4 --retry-delay 2 -o "$out" "$url"; then
      warn "Maia ${r} download failed"; rm -f "$out"; continue
    fi
    if ! verify_sha256 "$out" "$expected" "maia-${r}.pb.gz"; then
      warn "Maia ${r} rejected"; continue
    fi
    ok "Maia ${r} ready"; MAIA_NETS+=("$r")
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
    log "Cloning Lc0${LC0_REF:+ (${LC0_REF})}"
    # LC0_REF pins a tag/branch for reproducible builds; default stays master.
    git clone --depth 1 ${LC0_REF:+--branch "$LC0_REF"} --recurse-submodules --shallow-submodules \
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
# Syzygy tablebases — opt-in (WITH_SYZYGY=1 or ONLY=syzygy). Stockfish is pointed
# at these so ≤N-piece endgames are played and evaluated perfectly, offline.
# The backend auto-detects engines/syzygy at boot (no manifest entry needed).
# ---------------------------------------------------------------------------
setup_syzygy() {
  if [[ "${WITH_SYZYGY:-0}" != "1" && "${ONLY:-}" != "syzygy" ]]; then return 0; fi
  mkdir -p "$SYZYGY_DIR"
  if compgen -G "$SYZYGY_DIR/*.rtbw" >/dev/null 2>&1; then
    ok "Syzygy tablebases already present in engines/syzygy"; SYZYGY_OK=1; return 0
  fi

  local url="$SYZYGY_BASE_URL/$SYZYGY_SET/"
  log "Listing Syzygy files from $url"
  local index
  index="$(curl -fsSL "$url" 2>/dev/null)" || {
    warn "could not list $url — download the $SYZYGY_SET .rtbw/.rtbz files into engines/syzygy manually"
    return 1
  }
  local files
  files="$(printf '%s' "$index" | grep -oE '[A-Za-z]+v[A-Za-z]+\.rtb[wz]' | sort -u)"
  [[ -n "$files" ]] || { warn "no .rtbw/.rtbz links found at $url"; return 1; }

  local total n=0
  total="$(printf '%s\n' "$files" | wc -l | tr -d ' ')"
  log "Downloading $total Syzygy files for the $SYZYGY_SET set (this is large)"
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ -s "$SYZYGY_DIR/$f" ]]; then n=$((n + 1)); continue; fi
    if curl -fsSL --retry 4 --retry-delay 2 -o "$SYZYGY_DIR/$f.part" "$SYZYGY_BASE_URL/$SYZYGY_SET/$f"; then
      mv "$SYZYGY_DIR/$f.part" "$SYZYGY_DIR/$f"; n=$((n + 1))
    else
      warn "failed: $f"; rm -f "$SYZYGY_DIR/$f.part"
    fi
  done <<< "$files"

  if compgen -G "$SYZYGY_DIR/*.rtbw" >/dev/null 2>&1; then
    ok "Syzygy ready -> engines/syzygy ($n/$total files)"; SYZYGY_OK=1
  else
    err "Syzygy download produced no usable tablebases"; return 1
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
setup_syzygy    || warn "Syzygy setup incomplete"
write_manifest

# A previously-downloaded set still counts even on a filtered run.
compgen -G "$SYZYGY_DIR/*.rtbw" >/dev/null 2>&1 && SYZYGY_OK=1

echo
log "Summary:"
printf '  Stockfish : %s\n' "$([[ $STOCKFISH_OK -eq 1 ]] && echo available || echo MISSING)"
printf '  Lc0       : %s\n' "$([[ $LC0_OK -eq 1 ]] && echo available || echo 'missing (run without SKIP_LC0 to build)')"
printf '  Maia nets : %s\n' "$([[ ${#MAIA_NETS[@]} -gt 0 ]] && echo "${MAIA_NETS[*]}" || echo none)"
printf '  Syzygy    : %s\n' "$([[ $SYZYGY_OK -eq 1 ]] && echo "present ($SYZYGY_SET)" || echo 'none (WITH_SYZYGY=1 to fetch)')"
echo
[[ $STOCKFISH_OK -eq 1 ]] && exit 0 || exit 1
