#!/usr/bin/env bash
# ============================================================================
# Builds the two platform release archives into dist/:
#   asi-race-mac-zh.zip — ASI竞赛.app bundle + terminal launcher + 使用说明
#   asi-race-win-zh.zip — 启动游戏.cmd + app\launcher.ps1 + 使用说明
# Both bundle the FULL current game source including vendor/three.module.js,
# so a fresh download runs completely offline. The launchers keep their
# download-on-first-launch path purely as a repair fallback.
# Used locally and by .github/workflows/release.yml.
# ============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
rm -rf "$DIST"; mkdir -p "$DIST"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT

[ -s "$ROOT/vendor/three.module.js" ] || { echo "vendor/three.module.js missing in repo" >&2; exit 1; }

copy_game() { # $1 = destination game dir
  local d="$1"
  mkdir -p "$d/vendor"
  cp "$ROOT/index.html" "$ROOT/package.json" "$ROOT/CHANGELOG.md" "$d/"
  cp "$ROOT"/README*.md "$d/"
  cp -R "$ROOT/css" "$ROOT/js" "$ROOT/assets" "$ROOT/test" "$d/"
  cp "$ROOT/vendor/three.module.js" "$d/vendor/three.module.js"
  cat > "$d/vendor/README.txt" <<'TXT'
three.module.js 是游戏唯一的外部引擎文件（Three.js v0.170.0）。
本发行包已内置该文件，解压即可完全离线游玩。

若它意外丢失：
1) 联网后重新双击启动器，会自动补齐；或
2) 在任何能联网的设备手动下载
       https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js
   放回本目录（保持文件名不变）。
TXT
}

# ---- macOS -----------------------------------------------------------------
MACROOT="$STAGE/mac/ASI竞赛"
APP="$MACROOT/ASI竞赛.app/Contents"
mkdir -p "$APP/MacOS" "$APP/Resources"
cp "$ROOT/packaging/macos/Info.plist" "$APP/Info.plist"
cp "$ROOT/packaging/macos/run" "$APP/MacOS/run"
copy_game "$APP/Resources/game"
cp "$ROOT/packaging/macos/启动游戏.command" "$MACROOT/启动游戏.command"
cp "$ROOT/packaging/macos/使用说明.txt" "$MACROOT/使用说明.txt"
chmod +x "$APP/MacOS/run" "$MACROOT/启动游戏.command"
( cd "$STAGE/mac" && zip -qry "$DIST/asi-race-mac-zh.zip" "ASI竞赛" )

# ---- Windows ----------------------------------------------------------------
WINROOT="$STAGE/win/ASI竞赛"
mkdir -p "$WINROOT/app"
cp "$ROOT/packaging/windows/launcher.ps1" "$WINROOT/app/launcher.ps1"
copy_game "$WINROOT/app/game"
cp "$ROOT/packaging/windows/启动游戏.cmd" "$WINROOT/启动游戏.cmd"
cp "$ROOT/packaging/windows/使用说明.txt" "$WINROOT/使用说明.txt"
( cd "$STAGE/win" && zip -qry "$DIST/asi-race-win-zh.zip" "ASI竞赛" )

ls -la "$DIST"
