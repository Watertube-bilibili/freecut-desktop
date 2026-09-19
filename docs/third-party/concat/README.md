# Concat (formerly WolfCut) source provenance

This directory records the Concat material used by FreeCut from
[`jub0t/Concat`](https://github.com/jub0t/Concat), commit
`e5c8662daf6d721de2fd6c4e78cb671cd6d98393`, inspected on 2026-09-19.

Copyright: **2026 Jareer and Concat contributors**. The adapted algorithms
remain **AGPL-3.0-or-later**; FreeCut's original GPL-3.0-or-later code retains
its own license. See [the integration record](../../WOLFCUT-INTEGRATION.md)
for the precise boundary and combined-work obligations.

- `AGPL-3.0.txt` is upstream `LICENSE`, unmodified.
- `LICENSE-EXCEPTIONS.md` and `TRADEMARK.md` are unmodified upstream texts.
- `provenance.json` records exact upstream paths, SHA-256 digests and
  byte counts, the portions adapted and destination paths. Digests cover
  **raw Git blob bytes**, not a checkout's platform-specific line endings.

The plugin exception is preserved as provenance; **FreeCut does not claim
that exception for these source-code adaptations**. Each adapted source
file carries the upstream copyright, SPDX license and modification notice.
Upstream interface files listed as `interaction-reference-only` are
references for behavior, not copied Slint code or artwork.

No upstream logo, proprietary font, effect-preview photograph, Slint
runtime, Rust executable or downloaded model is redistributed by this
integration. Those materials are not covered by the algorithm provenance
and must be reviewed separately if introduced later.

Releases must retain these notices and provide the complete corresponding
FreeCut source, including adapted modules and the scripts needed to build
them, alongside the matching binaries. The existing FFmpeg corresponding
source bundles remain separately required.
