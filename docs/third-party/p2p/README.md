# P2P dependency notices and license review

Review date: **2026-09-14**. Entry dependency: **hyperdht 6.34.0**. FreeCut / 水管剪辑's original application code remains GPL-3.0-or-later. Third-party components retain the licenses and copyright notices preserved here.

## Scope and result

The [installed dependency inventory](DEPENDENCIES.md) and [machine-readable manifest](MANIFEST.json) cover **56 installed packages**, following production dependencies, optional dependencies and installed peer dependencies recursively from `hyperdht`. Absent optional peers are recorded, not downloaded. Versions and npm integrity values come from the actual installation and `package-lock.json`; development-only packages are excluded. MIT, Apache-2.0 and ISC are the package-level declarations in this closure.

Original `LICENSE`, `NOTICE`, copyright and author documents are copied without rewriting their contents. `SOURCE-NOTICES.txt` files preserve complete attribution/license comment blocks from shipped sources and fixed native source archives, with their original file locations. The manifest records SHA-256 values for notice files, native archives and source files from which comments were extracted. Apache `NOTICE` files omitted by npm packaging are additionally obtained from official repositories at the published git revision or release tag; the exact successful URL is retained.

**One upstream license text remains unresolved: `noise-curve-ed 2.1.0`.** The npm package declares `ISC` in `package.json`, with an empty author field, but contains no full license or copyright notice. Its official [v2.1.0 source tag](https://github.com/holepunchto/noise-curve-ed/tree/v2.1.0) also has no license file. The [original npm metadata](npm/noise-curve-ed@2.1.0/package.json) and [official tag file listing](upstream/npm/noise-curve-ed@2.1.0/UPSTREAM-TREE.json) are preserved as evidence; neither is represented as an original ISC license text. The package's published `gitHead` is no longer resolvable in the current official repository, so the tag evidence is distinguished from a verified byte-identical source checkout. No copyright holder or grant has been invented. Obtain a complete upstream grant/attribution or remove/replace this component before describing this dependency review as fully cleared for distribution.

The licenses whose texts were located permit GPLv3 combinations when their notice and other conditions are followed. The [FSF's GPLv3 guide](https://www.gnu.org/licenses/quick-guide-gplv3.html) explains compatibility including ISC and permissive licenses; the [Apache Software Foundation](https://www.apache.org/licenses/GPL-compatibility) explicitly confirms Apache-2.0 compatibility with GPLv3. CC0 and the preserved permissive Unicode data terms impose no incompatible application licensing condition identified in this review. This does not change each component's license, remove attribution duties, or grant rights to third-party media.

## Native components inside the dependency packages

| Component | Fixed source inspected | Used by | Preserved terms |
| --- | --- | --- | --- |
| libudx | [a9af5de](https://github.com/holepunchto/libudx/tree/a9af5de) | udx-native 1.21.1 | Apache-2.0 and upstream NOTICE |
| libuv | [v1.51.0](https://github.com/libuv/libuv/tree/v1.51.0) | libudx | MIT, original Joyent notice, BSD-2-Clause `tree.h`, ISC `inet.c`, source notices |
| libjstl | [098664c](https://github.com/holepunchto/libjstl/tree/098664c) | udx-native and sodium-native headers | Apache-2.0 and NOTICE |
| libsodium | [e18eee6](https://github.com/jedisct1/libsodium/tree/e18eee6) | sodium-native 5.1.0 | ISC; BSD-2-Clause SHA/scrypt code; CC0 Argon2/BLAKE2 code; public-domain statements and AUTHORS |
| libutf | [a1ceca8](https://github.com/holepunchto/libutf/tree/a1ceca8) | bare-url 2.5.4 | Apache-2.0, NOTICE, additional simdutf author/license comments |
| libpunycode | [e91ee34](https://github.com/holepunchto/libpunycode/tree/e91ee34) | bare-url 2.5.4 | Apache-2.0 and NOTICE |
| libnormalize | [0e81f65](https://github.com/holepunchto/libnormalize/tree/0e81f65) | bare-url 2.5.4 | Apache-2.0, NOTICE, Unicode data terms |
| libidna | [1471406](https://github.com/holepunchto/libidna/tree/1471406) | bare-url 2.5.4 | Apache-2.0, NOTICE, Unicode data terms |
| liburl | [2efedc5](https://github.com/holepunchto/liburl/tree/2efedc5) | bare-url 2.5.4 | Apache-2.0 and NOTICE |
| bare-compat-napi | [v1.3.5](https://github.com/holepunchto/bare-compat-napi/tree/v1.3.5) | Node-API compatibility headers used to build native modules | Apache-2.0; provenance qualification below |

`libsodium`'s BLAKE2 header offers CC0, historical OpenSSL, or Apache-2.0 at the recipient's choice. For this distribution the **CC0 option** is selected; no historical OpenSSL advertising condition is imported. The [complete CC0 text](upstream/licenses/CC0-1.0.txt) and original source declarations are preserved, including the BSD author statements that are separate from libsodium's top-level ISC license.

The Bare-only modules are included conservatively because their packages ship `.bare` prebuilds, even though FreeCut runs on Electron/Node rather than the Bare runtime. System libraries and an external Bare runtime are not claimed as newly bundled P2P components. Libuv's separate documentation license is not copied because its documentation is not embedded or redistributed here.

## Provenance qualifications

The native revisions above are read from the installed packages' CMake files and recursively inspected source inputs. Their license texts and source-header attributions are preserved. This is **not** proof that the upstream npm `.node` / `.bare` prebuilds were reproducibly built from exactly those inputs; upstream binaries are used without claiming a matching compiler or a verified complete build attestation.

`bare-compat-napi` is a build dependency specified by ranges (`^1.3.5` in sodium-native and `^1.3.0` in udx-native). Its exact header revision in the supplied binaries is not recorded in these npm packages. Version 1.3.5's original license and source notices are retained as a conservative supplement; it is not falsely listed as an installed production dependency or as an established binary input. The same limitation applies to build-tool and compiler versions.

`libnormalize` and `libidna` generate tables from the Unicode Character Database through `cmake-ucd`; their table recipes are preserved under `upstream/native/*/provenance`. The declared `cmake-ucd ^0.1.0` line [defaults to Unicode 17.0.0](https://github.com/holepunchto/cmake-ucd/blob/v0.1.0/cmake-ucd.cmake), but the setting can be overridden by the upstream builder. The exact data version in a supplier prebuild is therefore not established by this source review. The [complete official Unicode License V3](upstream/licenses/Unicode-3.0.txt), downloaded from [Unicode's license page](https://www.unicode.org/license.txt), preserves Unicode's grant and copyright notice for the generated data. No claim is made that the Apache license of a generator replaces the data license.

No incompatible license was found in the inspected native runtime source notices. This is a copyright-license and provenance review, not a patent search, trademark clearance or assurance that all legal claims are impossible. In particular, open-source availability and the presence of Apache patent terms do not guarantee that no third party holds a relevant patent.

## Distribution and maintenance

Include the **entire `docs/third-party/p2p/` directory**, together with root `THIRD_PARTY_NOTICES.md` and `LICENSE`, in the packaged app or an equally accessible bundled notices directory. For electron-builder, add `docs/third-party/p2p/**/*` to `files`, or copy this directory intact as an `extraResources` item. Keep all relative links and subdirectories intact. Merely linking to GitHub while omitting these original texts from the installer is not the intended notice delivery.

After a normal `npm ci`, regenerate or verify offline:

```sh
node docs/third-party/p2p/generate-notices.cjs
node docs/third-party/p2p/generate-notices.cjs --check
```

The check fails on changed installed versions, changed original notice bytes, missing frozen texts or stale generated inventory. It does not silently turn the documented ISC declaration into a complete license grant. For a strict clearance gate, add `--strict`; it deliberately fails while a full license remains unresolved.

For a deliberate dependency update, first review and update the fixed native references in `refresh-upstream.cjs`, then run:

```sh
node docs/third-party/p2p/refresh-upstream.cjs
node docs/third-party/p2p/generate-notices.cjs
```

The refresh explicitly accesses official npm/GitHub/Unicode/Creative Commons sources and extracts source archives to a temporary inspection directory. It does not execute fetched package scripts. Review the resulting diff, original source notices, unresolved items and provenance limitations before publishing. Old version directories are not automatically deleted; remove an obsolete directory only after verifying that it is no longer distributed. When native binary inputs change, reviewing only npm's top-level SPDX fields is insufficient.

`npm audit --omit=dev --json` reported **0 production vulnerabilities** during this review. That is a dated package-advisory result, not a security audit of this collaboration implementation or a guarantee about future advisories.
