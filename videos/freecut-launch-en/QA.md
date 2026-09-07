# English visual-input verification

Verified on 2026-09-07. This report covers the English **HyperFrames visual input**. The later export through the actual FreeCut application has a separate report and is not claimed as complete here.

## Source and screenshots

- Seven contiguous scenes run from 0 to 55 seconds. There are no audio, narration, music, sound-effect, or caption mounts.
- Four 1920×1080 screenshots came from the real FreeCut 0.3.1 Electron application with English selected. Each was visually inspected and matched against the hashes in [capture-provenance.json](assets/capture-provenance.json). The source includes no fabricated UI or Chinese screenshot placeholders.
- All designed main copy is English. The requested creator credit `@我叫水管同学` remains. The only closing call to action is downloading and starring the GitHub repository; there is no donation or Bilibili call to action.
- The headline promises all features free forever, with no memberships or paid unlocks. The tools scene separately states the ChatTTS model's non-commercial restriction. Mobile-style layout is shown as part of the desktop application.
- Original artwork, the product icon, Noto fonts and their full license, and GSAP with its full license are retained. See [SOURCES.md](SOURCES.md).

## Browser checks and visual review

HyperFrames 0.8.30 was pinned and checked against the current CLI release. The following command passed at 21 timeline samples, with zero errors or warnings in lint, runtime, layout, and contrast:

```text
npm run check -- --snapshots --at 0.5,3.5,6.5,7.5,10.5,13.5,14.5,18,21.5,22.5,26,29.5,30.5,35,39.5,40.5,43.5,46.5,47.5,51,54.96 --json
npx --yes hyperframes@0.8.30 snapshot --frames 14 --json
```

The structured check result is [qa/source-check.json](qa/source-check.json). Fourteen additional snapshots and their contact sheets were visually reviewed across all seven scenes. Main text, screenshots, creator credit, model-license note, and GitHub address are legible and in frame. The original reveal motion and hard scene boundaries remain; screenshot changes are labelled as screenshots rather than simulated screen recordings.

## Actual video

```text
npm run render -- --quality high --workers 4 --no-low-memory-mode --output renders/freecut-launch-en-visual-1080p.mp4
node scripts/verify-video.cjs
```

Rendering took approximately 84 seconds on the test machine. Only the render process used an isolated temporary directory on a drive with sufficient space; global user settings were not changed.

| Check | Result |
| --- | --- |
| File | `renders/freecut-launch-en-visual-1080p.mp4` |
| Duration | 55.000 seconds |
| Picture | H.264, 1920×1080, 30 fps |
| Frames | 1,650 |
| Audio / subtitle streams | 0 / 0 |
| Full decode with FFmpeg `-xerror` | Passed |
| Full black segments | 0 |
| File size | 5,383,042 bytes |
| SHA-256 | `a326b613fc456858907f7baaf9d13c8193d31f5c620bdf532cc57b53fe0a590b` |

The video verifier decoded representative frames at 6.5, 13.5, 21.5, 29.5, 39.5, 46.5, 51, and 54.96 seconds. The resulting contact sheet and full-resolution first/tools scenes were visually reviewed. The complete main copy, original branding, accurate English UI, model note, and final Star call to action are present; there are no line-by-line subtitles.

The portable result summary is [qa/visual-verification.json](qa/visual-verification.json). Re-running the verifier writes the media probe, strict decode log, sample PNGs, contact sheet, and hash list under `renders/`. Large rendered media and diagnostic logs are excluded from source control.
