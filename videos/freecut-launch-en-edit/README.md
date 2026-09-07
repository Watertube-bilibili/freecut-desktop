# FreeCut English launch film — final product edit

This recipe imports the [English visual source](../freecut-launch-en/README.md) into the actual FreeCut application, assembles seven scene ranges as editable timeline clips, saves a `.freecut` project and exports the final MP4 through the product renderer. HyperFrames supplies the designed visual input; it does not replace the final FreeCut export.

55 seconds · 1920×1080 · 30 fps. No narration, music, sound effects or line-by-line subtitle track. The designed English headlines and the requested creator credit **@我叫水管同学** remain. The call to action is download + GitHub Star, with no donation request. All features are free forever, with no memberships, paid unlocks or export watermark. The creator credit is part of this promotional artwork, not a watermark added by FreeCut to users' exports.

Render and validate the adjacent visual source first, then run from the repository root:

```text
node skills/shuiguan-cut/scripts/shuiguan-cut.cjs doctor --repo .
node skills/shuiguan-cut/scripts/shuiguan-cut.cjs edit-render --repo . --recipe videos/freecut-launch-en-edit/recipe.json --out-dir renders/freecut-launch-en-freecut --timeout 1800
```

The output directory must not already exist. Keep `project.freecut`, the referenced media and `report.json`. Only a successful actual product export may be named `renders/freecut-launch-en-1080p.mp4`. FreeCut exports a silent AAC stream when there is no sound; decode and check its samples before describing the final file as silent.

The saved project references the local source path. On another computer, relink that one asset to the supplied `media/visual-source.mp4`, then save. A portable relative-path recipe can reproduce the edit without changing the genuine exported project. Final verification is recorded in `QA.md` after completion.
