# English launch film — real FreeCut export verification

Completed on 2026-09-07. The final film was assembled and exported through **FreeCut 0.3.1**, using the repository's `shuiguan-cut` Skill in an isolated source-app profile. HyperFrames produced the designed visual input; the final edit is a genuine FreeCut project and product export.

## Verified final output

| Item | Result |
| --- | --- |
| Final file | `renders/freecut-launch-en-1080p.mp4` |
| Product output | `renders/freecut-launch-en-freecut/render.mp4` — byte-identical to the final file |
| Project | `renders/freecut-launch-en-freecut/project.freecut` |
| Product report | `report.json`: `passed: true`, app/source version `0.3.1` |
| Edit | Seven contiguous clips, one visual source, 55.000 seconds |
| Picture | H.264, 1920×1080, 30 fps, 1,650 frames |
| File size | 2,301,358 bytes |
| SHA-256 | `5bcb34187c7db9773185808d14a588a61ad4358a5e8ac8f3c6bb650b20aa9e56` |
| Complete video decode | Passed, no full black frames |
| Audio verification | 5,280,000 decoded stereo samples; peak 0, RMS 0 |
| Renderer errors | 0 |

The product exports a silent AAC stream. There is no narration, music or sound effect; this is verified from every decoded audio sample, not inferred from the absence of an audio asset. No line-by-line subtitles were added. Designed English headlines, feature descriptions and the requested `@我叫水管同学` creator credit are part of the picture.

The actual product used Electron 44.2.0 and the prepared local FFmpeg 6.1.1 development engine. Source-app `app.getVersion()` reports Electron's version, while the product-info IPC and source package both report FreeCut 0.3.1. This local export does not claim to use the separate source-built FFmpeg binaries shipped by release CI.

## Source and picture checks

The visual source is `videos/freecut-launch-en/renders/freecut-launch-en-visual-1080p.mp4`, 5,383,042 bytes, SHA-256 `a326b613fc456858907f7baaf9d13c8193d31f5c620bdf532cc57b53fe0a590b`. It contains only a video stream, with no audio or subtitle stream. Its source, font/runtime licenses, four actual English-app screenshots and independent full-decode check are recorded in [the visual source QA](../freecut-launch-en/QA.md).

The final product video was decoded at 3, 12.5, 18.5, 26, 35, 44, 53 and 54⅔ seconds for a contact sheet. Visual review confirmed English headings, actual English UI, student/GPT-6/Codex credit, FreeCut branding, both layouts, keyframe and preview controls, and the download + GitHub Star closing card. The complete visual-source review also checks the later reveal of the all-features-free promise and the model-license footnote. No donation request or Bilibili call to action is present. The author credit is retained as requested; normal FreeCut exports do not add it.

The seven clip ranges are 0–7, 7–14, 14–22, 22–30, 30–40, 40–47 and 47–55 seconds. Each uses the matching source in-point and zero clip volume. The genuine project is saved unchanged and references the original absolute source path. For another computer, relink the sole visual asset to the editing kit's `media/visual-source.mp4`; a separate relative-path recipe is supplied for reproduction.

Machine evidence remains with the product output: `report.json`, `qa/silent-verification.json` and `qa/contact-sheet.png`. The editing-kit packager requires these exact hashes and passed results, preserves the genuine project bytes, excludes unrelated audio/models/cache, and verifies every ZIP entry by decompressing and checking its size and SHA-256.
