# FreeCut 0.3.1 Quickstart

[简体中文](QUICKSTART.md) · [English](QUICKSTART.en.md)

FreeCut is an open-source desktop video editor. **All features are free forever: no membership, paid unlocks, or export watermark.** It is an early preview; start with a short project. If it helps you, please [Star FreeCut on GitHub](https://github.com/Watertube-bilibili/freecut-desktop).

## Choose your download

Get one application file from [GitHub Releases](https://github.com/Watertube-bilibili/freecut-desktop/releases).

| Computer / preference | File | Use |
| --- | --- | --- |
| Windows 10/11 x64, regular installation | `FreeCut-0.3.1-win-x64-Setup.exe` | Choose C drive, D drive, or a custom folder in the installer. |
| Windows 10/11 x64, no installation | `FreeCut-0.3.1-win-x64-Portable.exe` | Run from a writable folder. Keep the adjacent `FreeCutData` folder when moving it. |
| Mac with Apple silicon (M series) | `FreeCut-0.3.1-mac-arm64.dmg` | Open and drag FreeCut into Applications. |
| Mac with an Intel processor | `FreeCut-0.3.1-mac-x64.dmg` | Open and drag FreeCut into Applications. |
| Mac, archive preference | Matching `mac-arm64.zip` or `mac-x64.zip` | Extract FreeCut.app; choose ZIP or DMG, not both. |

Check Apple menu → About This Mac for your chip. Source archives are for developers and license compliance; you do not need them to run the app. `SHA256SUMS.txt` provides download hashes. Windows builds are unsigned; Mac builds use an ad hoc signature and are not notarized. Mobile-style layout is inside the desktop application, not an iOS or Android app.

## Language and installation

**First launch defaults to Simplified Chinese.** Open Home → 设置 → 简体中文 Language and select **English**, or use the language selector at the top of the editor. Your selection persists across restarts. Project titles, filenames and your own text are not automatically translated. The custom Windows installer has a separate language selector.

The installer does not preselect a drive. C uses the current user's application directory, D uses `D:\FreeCut`, and Custom lets you choose a writable folder. Missing parent and child folders are created automatically. Selecting a drive root adds a `FreeCut` subfolder; installing directly into a drive root is forbidden. A missing D drive is disabled.

You can install over a verified older FreeCut installation, including the legacy 0.2.0 layout. The installer checks the old application's identity before replacing incoming program files, preserving projects, models and unrelated files. Unknown applications are not overwritten. Use the new uninstaller after upgrading; preserved legacy uninstallers must not be run against the new installation.

## Make your first video

1. Choose **New project**, or **Open project** for a saved `.freecut` file. The first-run guide highlights the top-left desktop/mobile layout switch.
2. Choose **Import media** and select local video, images or audio. Double-click an asset or drag it onto the timeline.
3. Select a clip, drag its ends to trim, and split at the playhead. Select an object in the preview to drag it, resize with a corner, or rotate with the handle. Escape cancels a live drag; one gesture makes one undo step.
4. Add text, import SRT captions, or apply effects, color adjustments and geometric masks.
5. Save the `.freecut` project. It references your original media files; keep those files or relink them after moving them.
6. Choose **Export**, set resolution, frame rate and quality, then save a watermark-free H.264/AAC MP4.

Desktop and mobile-style layouts edit the same project. The mobile inspector can be closed with its X button or Escape. Left media and right properties panels scroll independently.

## Context menus and keyframes

Right-click a clip, preview object, track, timeline blank area or library asset for its available actions. Copy, cut and paste preserve keyframes and create independent clip IDs. Track-menu paste uses the clicked timeline time; the keyboard shortcut pastes at the playhead. Locked tracks reject edits, and assets currently used in the project cannot be removed from the library. Clip clipboard is internal to the current project, not a system or cross-project clipboard.

In Easy mode, select a clip and choose **Record current frame** to capture its transform, or record volume for audio. Move the playhead, adjust the picture, and record again to create motion. Professional mode exposes individual values and interpolation. Switching mode never deletes your animation.

| Action | Windows | Mac |
| --- | --- | --- |
| Play / pause | Space | Space |
| Save / open | Ctrl+S / Ctrl+O | Command+S / Command+O |
| Copy / cut / paste | Ctrl+C / Ctrl+X / Ctrl+V | Command+C / Command+X / Command+V |
| Duplicate after clip | Ctrl+D | Command+D |
| Split selected clip | Ctrl+B | Command+B |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z | Command+Z / Command+Shift+Z |
| Open focused object's menu | Shift+F10 | Shift+F10 (Fn may be needed) |

Text inputs keep their normal editing shortcuts. In a menu, use arrows to navigate, Enter to act, and Escape to close.

## Audio, captions and speech

The built-in sound library contains 16 original synthesized CC0 sound effects that can be previewed and inserted directly. Audio controls offer stereo balance, separate left/right gains, left-only, right-only, mixed mono and swapped channels. These do not separate voices from a mixed recording.

AI Voice provides optional SenseVoice or Whisper tiny automatic captions, Chinese VITS speech, and experimental ChatTTS. Download the runtime and model from their panels, then generate locally. These are not bundled with the installer. Downloads can be cancelled and retried, with integrity checks and resume support. Review transcription and speech results before publishing. ChatTTS's official model is CC BY-NC 4.0 and is limited to non-commercial use; other models have their own terms. FreeCut's free software policy does not change third-party licenses. Optional model inference on Mac still needs device validation.

## Saving and updates

Closing with unsaved changes offers save, discard or cancel. Cancelled or failed saves keep the editor open. Returning home or replacing the current project also protects unsaved changes.

Home → Settings → Software updates checks this repository's Releases, downloads the correct platform package, verifies its SHA-256, and waits until idle before installation. You can postpone or disable automatic updates. Unsaved changes still need your choice before the app exits. Mac must run outside the read-only DMG; Portable keeps data in the adjacent `FreeCutData` folder.

## Current limits

FreeCut does not yet provide every feature of established editors. Multi-select clips, nested timelines, multicam, proxy generation, speed curves, motion tracking, advanced color grading and cloud collaboration are still pending. Export is currently H.264/AAC MP4. Use the [English README](../README.en.md) and [feature matrix](FEATURE-MATRIX.md) for the implemented scope, and [verification record](VERIFICATION.md) for tested boundaries.
