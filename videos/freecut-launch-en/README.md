# FreeCut — English silent visual source

Seven scenes, 55 seconds, 1920×1080, 30 fps. This independent derivative preserves the original visual design and translates the main copy into English. The creator credit remains **@我叫水管同学**. The closing call to action is **download and star the GitHub repository**; this English version has no donation or Bilibili call to action.

No audio, narration, music, sound effects, or line-by-line subtitles are included. Designed headlines and feature descriptions are part of the picture. The software's mobile-style layout is explicitly shown as part of a desktop application, not an Android or iOS release.

## Screenshot requirement

`SCREENSHOTS-PENDING.json` records whether all four actual English-interface captures have arrived. `assets/manifest.json` records the approved files and SHA-256 values. The render and full-check commands run `scripts/verify-source.cjs` first and refuse to continue without genuine approved screenshots at these paths:

- `assets/editor-en.png`
- `assets/editor-keyframes-en.png`
- `assets/editor-transform-en.png`
- `assets/mobile-en.png`

No Chinese screenshot placeholders are copied into this project. Each capture is 1920×1080 and comes from the real FreeCut editor with its interface set to English.

## Reproduce the visual input

The pinned HyperFrames version and read-only version probe are recorded in `CLI-VERSION.md`. Once the screenshots are approved:

```text
npm run check -- --snapshots
npm run render -- --quality high --workers 4 --no-low-memory-mode --output renders/freecut-launch-en-visual-1080p.mp4
node scripts/verify-video.cjs
```

First use may download the pinned CLI and browser runtime. The project does not include `node_modules`, models, or prior rendered media. Use an isolated render-process TEMP/TMP directory if needed; do not change the user's global temporary directory.

The verification command requires FFmpeg and FFprobe on `PATH`. It checks all 1,650 frames through a strict decode, rejects audio and subtitle streams, verifies size and frame rate, checks for full black frames, and writes a contact sheet, representative frames, and a SHA-256 report in `renders/`. Review those images for English copy, screenshot accuracy, and legibility before handing the visual input to FreeCut.

`scripts/prepare-english.cjs` is the recorded derivation step from the adjacent frozen silent project. It resets the screenshot manifest and regenerates the initial English adaptations. Do not rerun it after making independent edits or approving screenshots. Normal checks and renders use this project's local HTML and assets and do not require the earlier project.

## Real FreeCut export

The HyperFrames MP4 is only a visual input. The parent task uses the FreeCut Skill to import it, split the seven scene ranges into actual timeline clips, save a real `.freecut` project, and export the final MP4. Final product export and visual-input verification must remain separate. Product export may contain a silent AAC track; check decoded PCM before calling it silent rather than assuming it has no audio stream.

FreeCut is an in-development editor. Feature copy reflects implemented functionality and identifies screenshots as screenshots. Mentioning GPT-6 and Codex describes the creator's tools; it does not imply OpenAI endorsement.

## Licenses

Original project code is covered by GPL-3.0; see `LICENSE-GPL-3.0.txt`. Noto fonts retain SIL OFL 1.1, and GSAP retains its included Standard License. The app's free-feature policy does not change third-party licenses. See `SOURCES.md` and `SOURCE-PROVENANCE.json`.
