#!/usr/bin/env bash
set -euo pipefail

# This script builds only the three SHA-256-pinned sources downloaded by the
# companion Node script. No system FFmpeg, third-party binary, or network input
# protocol is included. Run from a native Windows MINGW64 or macOS shell.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT/resources/ffmpeg-source/archives"
ENGINE_DIR="$ROOT/resources/ffmpeg-source/engine"
TARGET="${1:-}"
case "$TARGET" in win32-x64|darwin-x64|darwin-arm64) ;; *) echo 'Usage: bash scripts/build-ffmpeg.sh win32-x64|darwin-x64|darwin-arm64' >&2; exit 2;; esac
BUILD_ROOT="${FREECUT_FFMPEG_BUILD_ROOT:-$ROOT/.cache/ffmpeg-build-$TARGET}"
if command -v cygpath >/dev/null 2>&1; then BUILD_ROOT="$(cygpath -u "$BUILD_ROOT")"; fi
case "$BUILD_ROOT" in *' '*) echo 'FFmpeg makefiles require a build path without spaces. Set FREECUT_FFMPEG_BUILD_ROOT to a path such as /d/freecut-ffmpeg-build.' >&2; exit 2;; esac
PREFIX="$BUILD_ROOT/prefix"
JOBS="${FREECUT_BUILD_JOBS:-4}"
export SOURCE_DATE_EPOCH=1786492800
export ZERO_AR_DATE=1
export LC_ALL=C
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
mkdir -p "$BUILD_ROOT" "$PREFIX" "$ENGINE_DIR" "$ROOT/artifacts"
node "$ROOT/scripts/download-ffmpeg-sources.mjs"
for archive in ffmpeg-9.0.1.tar.xz x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz zlib-1.3.1.tar.gz; do tar -xf "$SOURCE_DIR/$archive" -C "$BUILD_ROOT"; done

{
  printf 'target=%s\nsource_date_epoch=%s\n' "$TARGET" "$SOURCE_DATE_EPOCH"
  uname -a
  cc --version
  make --version
  nasm -v
  pkg-config --version
  if command -v pacman >/dev/null 2>&1; then pacman -Q; fi
  if command -v xcodebuild >/dev/null 2>&1; then xcodebuild -version; fi
} > "$ENGINE_DIR/toolchain.txt" 2>&1

cd "$BUILD_ROOT/zlib-1.3.1"
if [[ "$TARGET" == win32-* ]]; then
  make -f win32/Makefile.gcc -j "$JOBS" libz.a
  mkdir -p "$PREFIX/include" "$PREFIX/lib/pkgconfig"
  cp libz.a "$PREFIX/lib/"
  cp zlib.h zconf.h "$PREFIX/include/"
  printf 'prefix=%s\nlibdir=${prefix}/lib\nincludedir=${prefix}/include\n\nName: zlib\nDescription: zlib compression library\nVersion: 1.3.1\nLibs: -L${libdir} -lz\nCflags: -I${includedir}\n' "$PREFIX" > "$PREFIX/lib/pkgconfig/zlib.pc"
else
  ./configure --static --prefix="$PREFIX"
  make -j "$JOBS"
  make install
fi

cd "$BUILD_ROOT/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55"
X264_FLAGS=(--prefix="$PREFIX" --enable-static --disable-cli --disable-opencl)
./configure "${X264_FLAGS[@]}"
make -j "$JOBS"
make install
cp config.mak "$ENGINE_DIR/x264-config.mak"

cd "$BUILD_ROOT/ffmpeg-9.0.1"
FFMPEG_FLAGS=(--prefix="$PREFIX" --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay --disable-ffprobe --disable-shared --enable-static --enable-gpl --enable-version3 --enable-libx264 --enable-zlib --pkg-config-flags=--static --extra-cflags="-I$PREFIX/include")
if [[ "$TARGET" == win32-* ]]; then
  FFMPEG_FLAGS+=(--target-os=mingw32 --arch=x86_64 --extra-ldflags="-L$PREFIX/lib -static -static-libgcc")
else
  FFMPEG_FLAGS+=(--extra-ldflags="-L$PREFIX/lib")
fi
printf '%q ' ./configure "${FFMPEG_FLAGS[@]}" > "$ENGINE_DIR/configure-command.txt"
printf '\n' >> "$ENGINE_DIR/configure-command.txt"
./configure "${FFMPEG_FLAGS[@]}"
make -j "$JOBS"
NAME=ffmpeg
if [[ "$TARGET" == win32-* ]]; then NAME=ffmpeg.exe; fi
cp "$NAME" "$ENGINE_DIR/$NAME"
cp ffbuild/config.mak "$ENGINE_DIR/ffmpeg-config.mak"
cp ffbuild/config.log "$ENGINE_DIR/ffmpeg-config.log"
cp COPYING.GPLv3 "$ENGINE_DIR/FFMPEG-LICENSE.txt"
cp "$BUILD_ROOT/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55/COPYING" "$ENGINE_DIR/X264-LICENSE.txt"
cp "$BUILD_ROOT/zlib-1.3.1/LICENSE" "$ENGINE_DIR/ZLIB-LICENSE.txt"
"$ENGINE_DIR/$NAME" -version > "$ENGINE_DIR/FFMPEG-BUILD.txt" 2>&1
"$ENGINE_DIR/$NAME" -buildconf >> "$ENGINE_DIR/FFMPEG-BUILD.txt" 2>&1
"$ENGINE_DIR/$NAME" -protocols > "$ENGINE_DIR/protocols.txt" 2>&1
if grep -E '^[[:space:]]+(http|https|tcp|udp|tls|rtmp|rtsp)$' "$ENGINE_DIR/protocols.txt"; then echo 'Unexpected network protocol in compiled FFmpeg' >&2; exit 1; fi
"$ENGINE_DIR/$NAME" -hide_banner -f lavfi -i color=c=red:s=32x32:d=0.1 -f lavfi -i sine=frequency=440:duration=0.1 -c:v libx264 -c:a aac -shortest -y "$BUILD_ROOT/smoke.mp4"

node - "$ENGINE_DIR" "$TARGET" "$SOURCE_DIR" <<'NODE'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const [directory,target,sourceDir]=process.argv.slice(2);
const executable=target.startsWith('win32-')?'ffmpeg.exe':'ffmpeg';
const sources=JSON.parse(fs.readFileSync(path.join(sourceDir,'sources.lock.json'),'utf8'));
const version=fs.readFileSync(path.join(directory,'FFMPEG-BUILD.txt'),'utf8');
if(!version.includes('--disable-autodetect')||!version.includes('--disable-network')||!version.includes('--enable-libx264')||version.includes('--enable-nonfree'))throw Error('Unexpected FFmpeg configure options');
const libraries=[...version.matchAll(/--enable-(lib[\w-]+)/g)].map(m=>m[1]);
if(libraries.some(name=>name!=='libx264'))throw Error('Unexpected external codec library');
const manifest={schema:1,provider:'FreeCut source build',target,executable,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,executable))).digest('hex'),sourceInputsComplete:true,externalLibraries:['x264','zlib'],systemLibraries:'Native operating-system libraries and the recorded compiler runtime; see toolchain.txt.',patches:[],sources:sources.sources,sourceBundle:`FreeCut-ffmpeg-source-${target}.tar.gz`,buildScript:'scripts/build-ffmpeg.sh',sourceDownloadScript:'scripts/download-ffmpeg-sources.mjs',reproducibility:'Fixed verified source inputs and recorded configure commands/toolchain. Bit-identical output across different compiler versions is not claimed.'};
fs.writeFileSync(path.join(directory,'source-manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(directory,'SOURCE-NOTICE.txt'),`This FFmpeg executable was built by FreeCut from the exact source archives listed in source-manifest.json. It links only x264, zlib and native system/compiler runtime libraries. The matching ${manifest.sourceBundle} contains the original archives, all build scripts, configure outputs, toolchain inventory and third-party licenses. No source patches were applied. Redistribute that source bundle alongside this binary. License: GPL version 3 or later; retain the individual x264 and zlib notices.\n`);
NODE

BUNDLE="$BUILD_ROOT/source-bundle"
mkdir -p "$BUNDLE/scripts" "$BUNDLE/resources/ffmpeg-source/archives" "$BUNDLE/build-record"
for archive in ffmpeg-9.0.1.tar.xz x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz zlib-1.3.1.tar.gz sources.lock.json; do cp "$SOURCE_DIR/$archive" "$BUNDLE/resources/ffmpeg-source/archives/"; done
cp "$ROOT/scripts/build-ffmpeg.sh" "$ROOT/scripts/download-ffmpeg-sources.mjs" "$ROOT/scripts/prepare-ffmpeg.mjs" "$BUNDLE/scripts/"
for file in "$ENGINE_DIR/"*; do if [[ "$(basename "$file")" != "$NAME" ]]; then cp "$file" "$BUNDLE/build-record/"; fi; done
cat > "$BUNDLE/BUILDING.md" <<'INFO'
# Rebuilding this FFmpeg executable

All non-system source inputs are included under resources/ffmpeg-source/archives.
The SHA-256-locked source downloader reuses these exact local archives; it never
needs to fetch newer revisions. There are no source patches.

Install Node.js 22+, GNU Make, a native C compiler, pkg-config and NASM. Windows:
run in MSYS2 MINGW64 with mingw-w64-x86_64-gcc, mingw-w64-x86_64-nasm,
mingw-w64-x86_64-pkgconf, make and diffutils. macOS: install Xcode Command Line
Tools, NASM and pkg-config. Use a build path without spaces.

Run one of:

    bash scripts/build-ffmpeg.sh win32-x64
    bash scripts/build-ffmpeg.sh darwin-x64
    bash scripts/build-ffmpeg.sh darwin-arm64

Build on the matching architecture. The resulting executable and source manifest
are written to resources/ffmpeg-source/engine. For the original build's exact
compiler versions, flags and source hashes see build-record. Only x264 and zlib
are enabled as external libraries; autodetection and network access are disabled.
Native OS libraries/compiler runtime are listed by the toolchain inventory.
Source inputs are fixed, but cross-toolchain bit-identical output is not claimed.
INFO
tar -czf "$ROOT/artifacts/FreeCut-ffmpeg-source-$TARGET.tar.gz" -C "$BUNDLE" .
echo "Source-built FFmpeg ready: $ENGINE_DIR/$NAME"
