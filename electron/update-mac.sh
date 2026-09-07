#!/bin/bash
set -euo pipefail
source_zip="$1"
target_app="$2"
old_pid="$3"
expected_sha="$4"
expected_version="$5"
quiet="${6:-}"
helper_dir="$(cd "$(dirname "$0")" && pwd)"
exec >"$helper_dir/result.txt" 2>&1
case "$old_pid" in ''|*[!0-9]*) exit 1;; esac
case "$target_app" in /*/FreeCut.app) ;; *) exit 1;; esac
case "$target_app" in /Volumes/*|*/AppTranslocation/*) exit 1;; esac
parent_dir="$(dirname "$target_app")"
[ "$parent_dir" != / ] && [ -d "$target_app" ] && [ ! -L "$target_app" ] && [ -w "$parent_dir" ]
[ "$(/usr/bin/shasum -a 256 "$source_zip" | cut -c 1-64)" = "$expected_sha" ]
for ((i=0; i<400; i++)); do
  if ! kill -0 "$old_pid" 2>/dev/null; then break; fi
  sleep 0.3
done
if kill -0 "$old_pid" 2>/dev/null; then echo 'FreeCut is still running'; exit 1; fi
stage_dir="$(mktemp -d "$parent_dir/.freecut-update.XXXXXX")"
backup_app="$stage_dir/previous.app"
rollback() {
  echo 'Update did not complete'
  if [ -d "$backup_app" ]; then
    if [ -e "$target_app" ]; then mv "$target_app" "$stage_dir/failed.app" || return; fi
    mv "$backup_app" "$target_app" || return
    echo 'Previous application restored'
  fi
  if [ "$quiet" != '--quiet' ]; then
    /usr/bin/osascript -e 'display alert "FreeCut 更新未完成" message "已尝试恢复原程序，工程数据没有改动。请查看更新日志后重试。"' || true
  fi
}
trap rollback ERR
# Only entries within the expected application bundle are accepted.
/usr/bin/unzip -Z1 "$source_zip" > "$stage_dir/entries.txt"
while IFS= read -r item; do
  case "$item" in FreeCut.app/*) ;; *) exit 1;; esac
  case "/$item/" in *'/../'*|*'/./'*) exit 1;; esac
done < "$stage_dir/entries.txt"
/usr/bin/ditto -x -k "$source_zip" "$stage_dir"
/usr/bin/codesign --verify --deep --strict "$stage_dir/FreeCut.app"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$stage_dir/FreeCut.app/Contents/Info.plist")" = 'org.freecut.desktop' ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$stage_dir/FreeCut.app/Contents/Info.plist")" = "$expected_version" ]
mv "$target_app" "$backup_app"
mv "$stage_dir/FreeCut.app" "$target_app"
/usr/bin/open -n "$target_app"
# Cleanup errors must not turn a successful launch into a failed update.
trap - ERR
# Both cleanup targets are fixed, checked paths created by this helper.
case "$stage_dir" in "$parent_dir"/.freecut-update.*) /bin/rm -rf "$stage_dir" || true;; *) exit 1;; esac
/bin/rm -f "$source_zip" || true
echo 'Update installed'
