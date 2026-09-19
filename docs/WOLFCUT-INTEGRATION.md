# WolfCut / Concat integration

水管剪辑 / FreeCut adopts selected code and editing interactions from
[Concat, formerly WolfCut](https://github.com/jub0t/Concat), pinned at
`e5c8662daf6d721de2fd6c4e78cb671cd6d98393` (inspected 2026-09-19).
The manifest at [third-party/concat/provenance.json](third-party/concat/provenance.json)
records raw-source SHA-256 digests and distinguishes adapted code from
interaction references. It does not track a moving upstream branch.

## What is integrated

| Upstream material                                                                          | FreeCut use                                                                                                                | Relationship                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `concat-core/src/animate.rs`: `bezier_axis`, `bezier_axis_slope`, `bezier_y_at_x`          | `shared/concat-bezier.mjs`: cubic-bezier timing with Newton iteration and bisection fallback, shared by preview and export | Rust algorithm adapted to JavaScript with TypeScript declarations; AGPL-3.0-or-later                       |
| `concat-export/src/lib.rs`: `place_layer`                                                  | `electron/concat-placement.cjs`: centered placement and normalized offsets for native FFmpeg composition                   | Selected arithmetic adapted to JavaScript; AGPL-3.0-or-later                                               |
| `concat-render/src/compositor.rs`: rotated bounds in `blend_transformed`                   | `electron/concat-placement.cjs`: sizing rotated layers                                                                     | Selected arithmetic adapted to JavaScript; AGPL-3.0-or-later                                               |
| Slint workspace, splitter, seat, media pane, timeline tray, preview pane and export dialog | Resizable workbench, media categories, grouped timeline controls, fit-to-timeline, frame stepping and export sections      | Behavior/design references implemented in FreeCut's React interface; no Slint code or visual assets copied |

The full upstream paths and hashes are in the manifest. This is **not a
replacement of FreeCut with the complete Concat app**, a Rust-engine
integration, or a claim of GPU export. FreeCut continues to use its
Electron/React host and its audited FFmpeg build. The actual renderer
chosen for an export depends on whether that project is supported by the
native composition path; unsupported features require the existing
compositor rather than being discarded. Performance must be measured
with specific projects and export settings.

The 2026-09-19 solver adaptation tightens the root tolerance to `1e-12`
and permits up to 48 bisection iterations for near-flat curves, instead
of upstream's `1e-7` and 32 iterations. FreeCut adds validation and its
own outgoing-key/seconds-based timing adapter; existing quadratic easing
semantics remain unchanged.

FreeCut retains its Chinese/English interface, desktop/mobile layouts,
easy keyframes, `.freecut` project compatibility, local speech and caption
tools with configurable voice-model storage, peer collaboration, custom
installer and update flow. This integration does not replace their
protocols or redistribute upstream speech models.

## Licenses and attribution

Concat's adapted source is copyright **2026 Jareer and Concat
contributors**, under **AGPL-3.0-or-later**. Adapted files retain that
copyright and state their FreeCut modifications and date. The complete
AGPL text, upstream exception and trademark policy are preserved in
[third-party/concat/](third-party/concat/).

FreeCut's original code remains **GPL-3.0-or-later** under the root
`LICENSE`. Section 13 of GPLv3 and AGPLv3 permits the combination; each
portion retains its applicable license and the AGPL network-source
requirements apply to the combined work. See the
[GNU compatibility explanation](https://www.gnu.org/licenses/license-compatibility.en.html)
and [AGPL text](https://www.gnu.org/licenses/agpl-3.0-body.html).

The Concat plugin exception is **not** used for these adaptations: it
does not cover vendoring internal code or translating substantial source
into another language. Keeping the original exception text does not turn
the adapted modules into permissively licensed code.

The product is still named 水管剪辑 / FreeCut and uses its own icon.
Attribution to Concat identifies the source, not sponsorship or
endorsement. No upstream fonts, logo, photographs, Slint runtime or
native dependencies are introduced by these algorithm ports. In
particular, the upstream Helvetica Neue files are excluded: an upstream
statement that it holds a font license does not establish downstream
redistribution rights.

## Corresponding source and distribution

The About page and collaboration panel offer a visible **source and
licenses** link to the public
[FreeCut repository](https://github.com/Watertube-bilibili/freecut-desktop).
The repository's release instructions must identify the source matching
each distributed version. Published binaries must be accompanied by the
complete corresponding application source archive, including adapted
modules, build scripts and license records, and the existing matching
FFmpeg dependency-source archives. A link to upstream `main` alone is
not a substitute for the source of the distributed modification.

Modified versions that allow remote network interaction must prominently
offer those users the corresponding source for the version they are
using, as required by AGPL section 13. Redistributors must update the
source destination when they distribute their own changes; the original
FreeCut repository cannot provide source for an unpublished downstream
fork.

This record documents the integration's licenses and exclusions; it is
not a claim that all possible patent, trademark or third-party issues
have been eliminated. Other dependency notices and unresolved findings
remain in `THIRD_PARTY_NOTICES.md` and the project's existing compliance
records.
