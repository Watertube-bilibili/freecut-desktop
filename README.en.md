<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Original FreeCut app icon">
</p>

<h1 align="center">FreeCut</h1>

<p align="center">An open-source desktop video editor. Make it yours.</p>

<p align="center"><a href="README.md">简体中文</a> | <strong>English</strong></p>

FreeCut is a video editor for Windows and macOS, built by middle-school student **@我叫水管同学** using **GPT-6 and Codex**. Its Chinese name is 水管剪辑; its English name remains FreeCut. The interface defaults to Simplified Chinese, with English available in Settings.

**All features are free forever. No memberships, no paid unlocks, and no export watermark.** No account is required. Media processing happens locally; updates and optional model downloads need an internet connection.

**The 0.5.0 preview is released.** This update adopts selected algorithms and editing interactions from [Concat, formerly WolfCut](https://github.com/jub0t/Concat): resizable panels, media categories, fit-to-timeline and frame stepping, cubic-bezier keyframes, and an expanded FFmpeg path for eligible layered compositions. Suitable text and shape layers are rendered to transparent images once before export. FreeCut retains its two layouts, Easy/Pro modes, speech tools, custom model storage, Internet collaboration and existing project compatibility. See the [integration and provenance record](docs/WOLFCUT-INTEGRATION.md). This is not a complete Rust-engine replacement or a new GPU encoder. See the [0.5.0 verification record](docs/VERIFICATION-050.md) for the actual test scope.

Custom speech-model storage remains available. In **AI Voice → Text to speech**, choose a parent folder; FreeCut creates a `FreeCut-VoiceModels` subfolder for ChatTTS, lightweight AISHELL Chinese speech models, and their model caches. This feature was introduced in 0.4.2; its original checks remain in the [0.4.2 verification record](docs/VERIFICATION-042.md). FreeCut does not cover every Jianying or CapCut feature. No account is required. Solo media processing is local; starting collaboration shares the project and its media with room members.

The previous 0.4.1 release passed two local desktop instances collaborating, real encrypted project/media transfers between Windows and a remote Linux machine, and native transport checks inside the Windows package. Narrow windows use compact toolbar buttons. See the historical [0.4.1 verification record](docs/VERIFICATION-041.md) and [Internet test summary](docs/verification/041-internet.json) for samples, timing, release status and scope; these do not establish a new Internet test for 0.5.0. The [0.5.0 verification record](docs/VERIFICATION-050.md) states this version’s actual scope. Earlier installer and export work remains documented in the [0.3.2 verification record](docs/VERIFICATION-032.md).

Changing the speech-model folder copies and verifies fully installed models before activating the new location, while keeping the original files. Existing download caches and incomplete files remain where they are; subsequent speech-model downloads use the new cache location. A failed change leaves the previous location active. Downloads or generation block folder changes; you can restore the default location, and your choice persists across restarts. Python and sherpa runtimes, generated audio, and SenseVoice/Whisper caption models stay in their original locations. This setting relocates installed speech models and selects the location for subsequent model caches, not all application data.

Preview playback now decodes continuously; scrubbing coalesces queued work without repeatedly aborting unfinished frames. Paused seeks remain precise and export keeps its separate frame-exact rendering. **Remote collaboration** defaults to Internet invitations: one computer hosts, another pastes the code, and FreeCut uses public discovery nodes and attempts NAT traversal to establish an encrypted peer-to-peer connection. Media and disjoint edits synchronize automatically; same-field conflicts preserve your local draft. No account, self-deployed server, or separate VPN is required. The host must stay online. Some restrictive networks prevent direct connections; bulk media relaying is not provided and connectivity is not guaranteed on every network. Advanced options retain IP-and-port LAN collaboration. See [instructions, privacy and limits](docs/COLLABORATION.md#english).

The 0.3.2 installer updates verified old FreeCut desktop and Start menu shortcuts, including when the install location changes. A separate icon file and Windows refresh notification address stale icons after upgrades. Fresh installations use the same new icon. User-customized shortcuts are preserved.

Automatic updates are enabled by default. Each launch checks this repository's Releases after about 12 seconds, downloads and verifies a newer matching package, then checks again every four hours. When idle, a countdown starts installation while unsaved projects retain their save prompt. If the Internet collaboration component is missing, the app explains how to reinstall; solo editing can still start.

Export automatically chooses the appropriate path. Version 0.5.0 supports direct FFmpeg export for eligible cuts, joins, still images and constant-speed edits, and extends that path to eligible layered compositions, static transforms, position animation and pre-rasterized titles/shapes. Unsupported effects, animated scale or rotation and other complex visuals retain the preview's compositor and send RGBA frames straight to the encoder. Effects are not silently dropped, and a temporary PNG is not generated for every frame. Results depend on the project and computer; historical measurements in the [0.3.2 verification record](docs/VERIFICATION-032.md) are not performance results for 0.5.0.

FLAC and other audio files with embedded album artwork are recognized as audio instead of treating the cover as video. Reopening an older project rereads available affected media and repairs the mistaken type while preserving clip position, timing, and volume animation.

## Preview

![FreeCut 0.5.0 English desktop workbench](docs/screenshots/editor-en-050.png)

![FreeCut 0.5.0 mobile-style layout in Simplified Chinese](docs/screenshots/mobile-050.png)

The second layout runs in the same desktop application. It is not an Android or iOS app.

These screenshots show the actual 0.5.0 source running on 2026-09-19: English desktop at 1440×900 and the mobile-style layout in Simplified Chinese at 1100×620. All seven workbench checks passed; see the [workbench evidence](docs/verification/050-workbench.json) and [0.5.0 verification record](docs/VERIFICATION-050.md). Installers and matching source are available in the download section below.

[Watch or download the English promo](https://github.com/Watertube-bilibili/freecut-desktop/releases/download/v0.3.1-preview.1/freecut-launch-en-1080p.mp4): 55 seconds, 1080p, exported through the actual FreeCut application and verified completely silent. It credits `@我叫水管同学` and asks viewers to download and Star the repository. Add your own music if you wish. See the [actual product export and silence verification](videos/freecut-launch-en-edit/QA.md), separate from the [English visual source](videos/freecut-launch-en).

[Download the English editing kit](https://github.com/Watertube-bilibili/freecut-desktop/releases/download/v0.3.1-preview.1/freecut-launch-en-editing-kit.zip) for the genuine `.freecut` project, visual input, reproducible recipe, English instructions and licenses. On another computer, relink the project's one missing asset to `media/visual-source.mp4` inside the kit.

## Editing features

This section describes the 0.5.0 preview, including its new workbench, bezier controls and expanded native composition.

- Resize workbench panels and filter media by type. Fit the timeline to all clips, use grouped editing tools and step through individual frames.
- Import local video, images, and audio. Arrange multiple tracks, layer picture-in-picture content, snap clips, trim, split, duplicate, and undo or redo edits.
- Use context menus on timeline clips, tracks, empty timeline space, and the preview to find actions for the current selection.
- Animate X/Y position, uniform scale, rotation, opacity, and volume. Keyframes use linear, ease-in, ease-out, ease-in-out, hold, or the new 0.5.0 cubic-bezier curves. Splitting preserves animation; existing projects keep their original easing behavior.
- Select objects directly in the preview, drag them, resize with corner handles, and rotate. A complete drag gesture is one undo step.
- Start in Easy mode to capture a group of visual keyframes with one action. Switch to Pro mode for exact values and easing controls.
- Add editable text and captions, with font size, color, background, and outline controls. Import and export SRT files.
- Apply 19 original color presets, blur, pixelation, vignette, mirroring, or green/blue chroma key. Seven geometric masks support position, rotation, feathering, and inversion.
- Preview and add 16 original sound effects. Adjust stereo balance, independent channel gains, left-only/right-only routing, mono, and channel swapping. Preview and export use the same channel routing.
- Set a constant playback speed, clip volume, and visual or audio fades. Animation presets create keyframes that remain editable.
- Work in landscape, portrait, or square formats. Export H.264/AAC MP4 at the available 720p, 1080p, 1440p, or 4K settings and 24–60 fps.
- Eligible cuts, layered compositions and position animation use native FFmpeg export automatically. Suitable titles/shapes are prepared as transparent images once. Other complex visuals send frames through an RGBA pipe without writing individual temporary PNG files.
- Save and reopen `.freecut` projects. Projects reference your original media files; they do not embed or duplicate those media files.
- Find recent projects on the home screen, with search and sorting. Settings and recent-project records persist across launches.
- Keep unsaved work protected when closing, going home, or opening another project. Cancelling a save or encountering a save error leaves the current project open.
- Play video with continuous decoding; scrubbing coalesces pending requests and prioritizes the latest frame. Switching layouts preserves the currently displayed image while the next frame is prepared.
- Host Internet collaboration and share an invite code. Automatic discovery and NAT traversal attempt an encrypted connection without a separate VPN. Projects and media synchronize; disjoint edits merge and conflicts preserve local drafts. IP-and-port LAN collaboration remains in Advanced options.
- Download optional open-source environments and models for automatic captions, Chinese text-to-speech, and ChatTTS. After installation, inference runs locally without uploading your media.
- Choose a custom folder for ChatTTS and lightweight Chinese speech models. Existing models are copied and verified before activation; restoring the default is supported in both interface languages.
- Install through an original Windows setup interface, with C:, D:, or a custom location. The app can check this repository's Releases, verify downloads, and prepare updates while protecting unsaved work.

## Download and install

[Download the 0.5.0 preview](https://github.com/Watertube-bilibili/freecut-desktop/releases/tag/v0.5.0-preview.1). The table lists this published version's package names; use the published assets on that Release for downloads, along with matching source, both guides and SHA-256 checksums. The same application supports both languages and starts in Simplified Chinese.

| Computer or use | Download | How to use it |
| --- | --- | --- |
| Windows 10/11 x64, regular installation | `FreeCut-0.5.0-win-x64-Setup.exe` | Choose your drive or folder; C: is not preselected. Upgrades repair eligible old shortcuts and their icons. |
| Windows 10/11 x64, no installation | `FreeCut-0.5.0-win-x64-Portable.exe` | Run from a writable folder. Keep the adjacent `FreeCutData` folder for settings, recent projects, and default models. Also retain any separately selected speech-model folder. |
| Mac with Apple Silicon | `FreeCut-0.5.0-mac-arm64.dmg` | Open the DMG and drag FreeCut into Applications. |
| Mac with an Intel processor | `FreeCut-0.5.0-mac-x64.dmg` | Install the same way. |
| Mac, ZIP format preferred | `FreeCut-0.5.0-mac-arm64.zip` or `FreeCut-0.5.0-mac-x64.zip` | Extract the app for your processor. DMG and ZIP contain the same application; choose one. |

You need only one application download for normal use; the source archives are for developers and license compliance. On macOS, **Apple menu → About This Mac** identifies your processor.

Windows builds are unsigned. Mac builds use ad-hoc signing and are not yet signed with a Developer ID or notarized by Apple. Each Release identifies its source commit and platform build records. The publishing workflow checks the application artifacts, matching source, and uploaded file hashes.

You can upgrade a verified legacy FreeCut installation, including 0.2.0, in its existing directory without uninstalling first. The installer checks the old application's identity and replaces only incoming program paths, preserving projects, models and unrelated files. Unknown programs are not overwritten. Missing parent and installation folders are created automatically. After upgrading, use the new uninstaller; do not run a preserved legacy uninstaller against the new directory. On macOS, place the app in a writable location such as Applications before updating; updating from inside a read-only DMG is not supported.

For a stale Windows desktop icon, upgrade using the **Setup installer**. Version 0.3.2 gives shortcuts a separate ICO file named by its SHA-256 content hash and sends Windows Shell an update notification. Clearing the entire system icon cache is unnecessary. The installer replaces only shortcuts confirmed to belong to FreeCut without user customizations. Portable builds do not change desktop shortcuts.

## Start editing

1. FreeCut starts in Simplified Chinese. On the home screen, open **设置 → 简体中文 Language** and select **English**, then choose **New project**. You can also use the language selector at the top of the editor. The choice persists across restarts.
2. Import local media and add it to the timeline. Drag clips into position, or use their context menus to find editing actions.
3. Select a clip to adjust its properties. Use Easy mode for one-click keyframe snapshots, or Pro mode for precise control.
4. Save the project, then export an MP4. Keep the original media files alongside your work. If you move them, use **Relink media** to locate them again.

Read the detailed [English quick-start guide](docs/QUICKSTART.en.md). Published Releases also include this guide as `FreeCut-Quickstart-en.md`.

## Optional local AI

Models are not bundled in the installer. Open the caption or voice tools, choose a model, and use the download action. The interface shows size, licensing, progress, cancellation, and retry controls. First use needs network access and sufficient disk space; CPU inference can be slow.

Model capabilities and licenses are separate from the application's free feature policy. **ChatTTS model weights use CC BY-NC 4.0 and are for non-commercial use only.** Open-source code does not grant unrestricted commercial rights to model weights. See the [model documentation](docs/AI-MODELS.md) and [ChatTTS documentation](docs/CHAT-TTS.md) for download details and the exact tested configurations. These documents are currently in Chinese.

## Let an AI edit through FreeCut

The free [shuiguan-cut Skill](skills/shuiguan-cut/SKILL.md) turns local media and a JSON editing recipe into a genuine `.freecut` project and an MP4 exported by the actual FreeCut application.

It launches an isolated application instance and uses the real import, project, Canvas, and FFmpeg paths. It does not replace the final export with another editor. The recipe bridge currently covers cuts, layered text and shapes, basic transforms and keyframes, constant speed, fades, volume, and stereo routing. Its scope is narrower than the full application.

See [AI editing setup](docs/AI-EDITING.md) and the [recipe reference](skills/shuiguan-cut/references/recipe.md). The Skill requires a compatible FreeCut source checkout and local dependencies; it does not bundle runtimes or models. Its output directory must be new, so existing output is not overwritten.

## Development

Use Node.js **22.12 or later** and npm on Windows x64 or macOS. Install from the lockfile. Some npm configurations require the binary download scripts to be run separately:

```sh
npm ci
node node_modules/electron/install.js
node node_modules/ffmpeg-static/install.js
npm run prepare:ffmpeg
npm run dev:desktop
```

Build the interface and run the tests:

```sh
npm run build
npm test
node scripts/smoke-desktop.cjs
node scripts/regression-editor.cjs
node scripts/regression-context-menu.cjs
node scripts/regression-language.cjs
node scripts/regression-preview.cjs
node scripts/regression-home.cjs
node scripts/regression-keyframes.cjs
node scripts/regression-transform.cjs
node scripts/regression-effects.cjs
node scripts/regression-audio.cjs
node scripts/regression-update.cjs
node scripts/regression-entry-url.cjs
# Windows custom installer interface
node installer/smoke.cjs
```

The desktop smoke test generates original local media and exercises the actual Electron app: layouts, import, keyframes, text, project save/reopen, and MP4 export. Results go into the ignored `artifacts/smoke/` directory. Tests use isolated profiles and test-owned file-dialog choices; they do not edit your existing projects.

Regression coverage includes save/close protection, real video seeks, keyframe controls, preview transforms, mask pixels, short-window scrolling, stereo preview/export, and update cancellation or failure. These tests establish the behavior of their tested fixtures, not the quality of every possible media file or model output.

Release 0.3.2 was built from `aba5cac`. Windows x64, macOS Intel and Apple Silicon passed this release's regressions and packaged-app media checks in the [matching CI run](https://github.com/Watertube-bilibili/freecut-desktop/actions/runs/34140392722). See the [0.3.2 verification record](docs/VERIFICATION-032.md) for details. These results cover the tested fixtures, not every hardware configuration, recording or long project.

In comparisons using the same projects, the ordinary-cut sample went from **18.025 seconds to 3.070 seconds**. The complex sample with overlays went from **15.170 seconds to 15.761 seconds, with no speed improvement**. These measurements apply to the specified computer and samples, not a universal speedup. The [export verification record](docs/VERIFICATION-032.md) describes the method and scope.

`npm run test:desktop` runs the build and desktop regressions. Real AI smoke tests disable downloads by default; the model documents explain how to explicitly prepare their dependencies.

For browser-only UI development, use `npm run dev`. Preview editing is available in the browser, but local models, complete project-media reopening, and FFmpeg video export require the desktop app.

Package locally:

```sh
npm run package:win
# Run on a Mac
npm run package:mac
```

Distributing the video engine also requires its corresponding source. CI uses the repository's pinned source-build process; quick local development uses the vendor's `ffmpeg-static` binaries. These are distinct sources. See [third-party notices](THIRD_PARTY_NOTICES.md) and the build scripts.

## Current limits

- This is a desktop application. The mobile-style layout is not an Android or iOS build.
- Eligible ordinary edits export directly through FFmpeg. Complex effects still require frame-by-frame decoding and Canvas composition, so long or 4K projects can take time. Piped export removes intermediate PNG files, but encoding and the final video still require memory and disk space. Proxy media and a GPU rendering pipeline are not implemented yet; speed improvements are not guaranteed to be the same on every computer.
- Preview decoding depends on formats supported by Electron. Common H.264 MP4, PNG/JPEG, WAV, and MP3 files are a practical starting point; some professional formats need transcoding.
- Speech recognition depends on language, recording quality, and model choice. Generated captions remain editable and are not guaranteed to be accurate.
- Model downloads and inference depend on network access, storage, and hardware. The documentation describes the actual tested scope; macOS model inference still needs validation on the corresponding devices.
- Curved speed ramps, reverse playback, pen masks, tracking, multicamera editing, multiple timelines, advanced AI cutout, video generation, and cloud collaboration are not complete.

## Architecture and licenses

FreeCut uses React, TypeScript and Electron. Version 0.5.0 adapts selected Concat algorithms and expands native FFmpeg composition while retaining Canvas and the RGBA pipe for unsupported complex visuals. Preview and host export share the bezier module. Title images are created only in a task-owned temporary directory, with count, byte-size and dimension checks. H.264 still uses x264's veryfast preset with four encoding threads; no Rust or GPU backend is claimed. Desktop IPC authenticates the application window and its main frame. Local media access is granted to files selected by the user or explicitly referenced by an opened project. See the [architecture document](docs/ARCHITECTURE.md).

Original FreeCut code remains **GPL-3.0-or-later** under [LICENSE](LICENSE). Bezier, placement and rotated-bounds algorithms adapted from Concat remain **AGPL-3.0-or-later**, copyright Jareer and Concat contributors. The combination follows section 13 of both licenses, including the applicable network-source requirement; internal-source adaptations do not use Concat's plugin exception. Read the full [AGPL text](docs/third-party/concat/AGPL-3.0.txt), [provenance and modifications](docs/WOLFCUT-INTEGRATION.md), and [third-party notices](THIRD_PARTY_NOTICES.md). About and collaboration expose source and license links. Redistributed installers must be accompanied by their matching complete corresponding source. Other libraries, models and media retain their own terms; the original icon and brand are documented in [BRAND.md](docs/BRAND.md).

Try the preview, report reproducible issues, and contribute improvements. **[Star FreeCut on GitHub](https://github.com/Watertube-bilibili/freecut-desktop)** to follow its progress.
