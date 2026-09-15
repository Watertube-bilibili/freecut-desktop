# FreeCut 0.4.2 Quickstart

[简体中文](QUICKSTART.md) · [English](QUICKSTART.en.md)

FreeCut is an open-source desktop video editor. **All features are free forever: no membership, paid unlocks, or export watermark.** It is an early preview; start with a short project. If it helps you, please [Star FreeCut on GitHub](https://github.com/Watertube-bilibili/freecut-desktop).

## Choose your download

Get one application file from [GitHub Releases](https://github.com/Watertube-bilibili/freecut-desktop/releases).

| Computer / preference | File | Use |
| --- | --- | --- |
| Windows 10/11 x64, regular installation | `FreeCut-0.4.2-win-x64-Setup.exe` | Choose C drive, D drive, or a custom folder in the installer. |
| Windows 10/11 x64, no installation | `FreeCut-0.4.2-win-x64-Portable.exe` | Run from a writable folder. Keep the adjacent `FreeCutData` folder and any separately selected speech-model folder when moving the app. |
| Mac with Apple silicon (M series) | `FreeCut-0.4.2-mac-arm64.dmg` | Open and drag FreeCut into Applications. |
| Mac with an Intel processor | `FreeCut-0.4.2-mac-x64.dmg` | Open and drag FreeCut into Applications. |
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

In 0.4.2, open **AI Voice → Text to speech** to choose a model-download parent folder. FreeCut creates a `FreeCut-VoiceModels` subfolder automatically; choosing `D:\Models`, for example, uses `D:\Models\FreeCut-VoiceModels`. This location holds ChatTTS and lightweight AISHELL Chinese speech models and their model caches.

Fully installed models are copied and verified before the new location becomes active. Original files remain, and a failed change keeps the previous location. Existing download caches and incomplete files are not copied; subsequent model downloads use the new cache location. Folder changes are blocked during downloads or generation. You can restore the default, and your choice persists across restarts. Copying requires space for both model copies and does not automatically reclaim the original files or old caches.

Python and sherpa runtimes, generated audio, and SenseVoice/Whisper caption models stay in their original locations. Keep those locations writable and retain audio referenced by projects. A separately selected model folder does not move automatically with Portable. This setting does not move all application data or change any model license.

## Saving and updates

Closing with unsaved changes offers save, discard or cancel. Cancelled or failed saves keep the editor open. Returning home or replacing the current project also protects unsaved changes.

Home → Settings → Software updates checks this repository's Releases, downloads the correct platform package, verifies its SHA-256, and waits until idle before installation. You can postpone or disable automatic updates. Unsaved changes still need your choice before the app exits. Mac must run outside the read-only DMG; Portable keeps data in the adjacent `FreeCutData` folder.

## Current limits

FreeCut does not yet provide every feature of established editors. Multi-select clips, nested timelines, multicam, proxy generation, speed curves, motion tracking, advanced color grading and cloud collaboration are still pending. Export is currently H.264/AAC MP4. Use the [English README](../README.en.md) and [feature matrix](FEATURE-MATRIX.md) for the implemented scope, and [verification record](VERIFICATION.md) for tested boundaries.

## Remote collaboration

1. The host opens **Remote collaboration → Create a room**, keeps **Across networks (invite code)** selected, and chooses **Create room & get invite code**. The room runs on that computer, which must stay online.
2. Send the complete `freecut2:` invite to a collaborator. They paste it into **Join a room**. No separate VPN, account, or self-managed server is needed. Save your local project before joining; shared media downloads automatically.
3. Use **Cancel connection** during preparation or connection. Cancellation and failure preserve the local project. Once connected, each person can preview, edit, and save independently. Resolve conflicts explicitly and retain downloaded files referenced by saved projects. Closing the panel keeps the connection; use **Leave room** or **End room** to disconnect.

Remote mode relies on public discovery nodes and attempts NAT traversal. Project and media traffic uses Noise encryption. Public nodes may observe network metadata, but do not receive plaintext projects or media. Some UDP restrictions or NAT configurations prevent direct connections. FreeCut has no media traffic relay and cannot guarantee connectivity on every network.

**Advanced: LAN / direct IP** retains IPv4, port (default `45823`), room keys, and legacy `freecut1:` invites. Legacy invites require an already reachable address and do not automatically connect across networks. This HTTP mode is unencrypted and is intended only for a trusted LAN or trusted encrypted VPN. See [the full guide](COLLABORATION.md#english) for permissions, limits, and cache retention, the [0.4.1 verification record](VERIFICATION-041.md) for actual public-network test coverage, and [P2P component licenses](third-party/p2p/README.md).
