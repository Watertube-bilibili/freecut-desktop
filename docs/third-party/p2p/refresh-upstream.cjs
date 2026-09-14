#!/usr/bin/env node
// Explicit online maintenance operation. Review its diff before distribution.
// Normal generation/checking is offline and never silently refreshes upstream text.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { inventory, base, safeName, sha256, noticeName } = require('./generate-notices.cjs')

const components = [
  { name: 'libudx', repository: 'holepunchto/libudx', ref: 'a9af5de', license: 'Apache-2.0', usedBy: 'udx-native@1.21.1', input: 'node_modules/udx-native/CMakeLists.txt' },
  { name: 'libuv', repository: 'libuv/libuv', ref: 'v1.51.0', license: 'MIT AND BSD-2-Clause AND ISC', usedBy: 'libudx', input: 'libudx/CMakeLists.txt' },
  { name: 'libjstl', repository: 'holepunchto/libjstl', ref: '098664c', license: 'Apache-2.0', usedBy: 'udx-native@1.21.1 and sodium-native@5.1.0', input: 'Both native modules CMakeLists.txt' },
  { name: 'libsodium', repository: 'jedisct1/libsodium', ref: 'e18eee6', license: 'ISC AND BSD-2-Clause AND CC0-1.0; public-domain source declarations; BLAKE2 multi-license election: CC0-1.0', usedBy: 'sodium-native@5.1.0', input: 'node_modules/sodium-native/CMakeLists.txt' },
  { name: 'libutf', repository: 'holepunchto/libutf', ref: 'a1ceca8', license: 'Apache-2.0 (including simdutf source notices)', usedBy: 'bare-url@2.5.4', input: 'node_modules/bare-url/CMakeLists.txt' },
  { name: 'libpunycode', repository: 'holepunchto/libpunycode', ref: 'e91ee34', license: 'Apache-2.0', usedBy: 'bare-url@2.5.4', input: 'node_modules/bare-url/CMakeLists.txt' },
  { name: 'libnormalize', repository: 'holepunchto/libnormalize', ref: '0e81f65', license: 'Apache-2.0 AND Unicode-3.0 for generated Unicode tables', usedBy: 'bare-url@2.5.4', input: 'node_modules/bare-url/CMakeLists.txt' },
  { name: 'libidna', repository: 'holepunchto/libidna', ref: '1471406', license: 'Apache-2.0 AND Unicode-3.0 for generated Unicode tables', usedBy: 'bare-url@2.5.4', input: 'node_modules/bare-url/CMakeLists.txt' },
  { name: 'liburl', repository: 'holepunchto/liburl', ref: '2efedc5', license: 'Apache-2.0', usedBy: 'bare-url@2.5.4', input: 'node_modules/bare-url/CMakeLists.txt' },
  { name: 'bare-compat-napi', repository: 'holepunchto/bare-compat-napi', ref: 'v1.3.5', license: 'Apache-2.0', usedBy: 'sodium-native / udx-native Node-API compatibility headers', input: 'sodium-native dev range ^1.3.5; udx-native dev range ^1.3.0; supplier prebuild exact header revision is not recorded', provenanceLimitation: true }
]
const files = []
const packageSources = []
const commentsPattern = /copyright|licen[cs]e|public[ -]domain|permission|redistribut|SPDX|written (?:in|by)|based on|adapted from|derived from/i

async function get(url, optional = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (optional && response.status === 404) return null
      if (!response.ok) throw new Error(`${response.status}: ${url}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`)
    }
  }
}
function store(relative, bytes, details) {
  fs.mkdirSync(path.dirname(path.join(base, relative)), { recursive: true })
  fs.writeFileSync(path.join(base, relative), bytes)
  files.push({ file: relative, sha256: sha256(bytes), ...details })
}
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'prebuilds') continue
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(target, out)
    else if (entry.isFile()) out.push(target)
  }
  return out
}
function sourceNotices(dir, selected) {
  const notices = []
  const inputs = []
  for (const file of walk(dir).filter(file => /\.(?:c|h|cc|cpp|s|js|mjs)$/i.test(file))) {
    const relative = path.relative(dir, file).replaceAll('\\', '/')
    if (!selected(relative)) continue
    const bytes = fs.readFileSync(file)
    const text = bytes.toString('utf8')
    const matches = [...text.matchAll(/\/\*[\s\S]*?\*\/|(?:^[ \t]*\/\/[^\r\n]*(?:\r?\n|$))+/gm)].filter(match => commentsPattern.test(match[0]))
    if (!matches.length) continue
    inputs.push({ path: relative, sha256: sha256(bytes) })
    for (const match of matches) notices.push(`===== ${relative}:${text.slice(0, match.index).split('\n').length} =====\n${match[0]}\n`)
  }
  return { bytes: Buffer.from(notices.join('\n')), inputs }
}

async function concurrency(items, action, count = 6) {
  let position = 0
  await Promise.all(Array.from({ length: count }, async () => {
    while (position < items.length) await action(items[position++])
  }))
}

async function refresh() {
  const packages = inventory()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-p2p-notices-'))
  console.log(`Auditing official source archives in ${temporary}`)
  await concurrency(packages, async item => {
    const key = `${item.name}@${item.version}`
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(item.name)}/${item.version}`
    const metadata = JSON.parse((await get(registryUrl)).toString('utf8'))
    let repository = (typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '')
    // GitHub preserves old raw URLs for transferred repositories, but use the canonical owner here.
    if (item.name === 'noise-curve-ed') repository = 'https://github.com/holepunchto/noise-curve-ed'
    const repo = repository.match(/github\.com[/:]([^/]+\/[^/]+)/)?.[1]
    const source = { package: key, registryUrl, gitHead: metadata.gitHead || null, repository, noticeChecks: [] }
    packageSources.push(source)
    if (repo) {
      const refs = [...new Set([metadata.gitHead, `v${item.version}`].filter(Boolean))]
      for (const name of ['NOTICE', 'COPYRIGHT', 'AUTHORS']) {
        if (fs.existsSync(path.join(item.directory, name))) continue
        for (const ref of refs) {
          const url = `https://raw.githubusercontent.com/${repo}/${ref}/${name}`
          const bytes = await get(url, true)
          source.noticeChecks.push({ url, found: Boolean(bytes) })
          if (bytes) { store(`upstream/npm/${safeName(key)}/${name}`, bytes, { package: key, url }); break }
        }
      }
    }
    const headers = sourceNotices(item.directory, relative => !/^test(?:s)?\//.test(relative))
    if (headers.inputs.length) store(`upstream/npm/${safeName(key)}/SOURCE-NOTICES.txt`, headers.bytes, { package: key, sourceArchive: item.resolved, inputs: headers.inputs })
  })
  await concurrency(components, async component => {
    const url = `https://codeload.github.com/${component.repository}/tar.gz/${component.ref}`
    const archive = await get(url)
    component.sourceArchive = url
    component.archiveSha256 = sha256(archive)
    const archivePath = path.join(temporary, component.name + '.tgz')
    const dir = path.join(temporary, component.name)
    fs.writeFileSync(archivePath, archive)
    fs.mkdirSync(dir)
    execFileSync('tar', ['-xf', archivePath, '--strip-components=1', '-C', dir], { windowsHide: true })
    for (const name of fs.readdirSync(dir).sort()) {
      if (!noticeName.test(name) || !fs.statSync(path.join(dir, name)).isFile()) continue
      // libuv documentation is not embedded or redistributed; its docs license is a different artifact.
      if (component.name === 'libuv' && name === 'LICENSE-docs') continue
      store(`upstream/native/${component.name}/${name}`, fs.readFileSync(path.join(dir, name)), { component: component.name, url: `https://raw.githubusercontent.com/${component.repository}/${component.ref}/${name}` })
    }
    const headers = sourceNotices(dir, relative => /^(?:src|include)\//.test(relative))
    if (headers.inputs.length) store(`upstream/native/${component.name}/SOURCE-NOTICES.txt`, headers.bytes, { component: component.name, sourceArchive: url, inputs: headers.inputs })
    for (const relative of ['CMakeLists.txt', 'cmake/tables.cmake']) {
      if (fs.existsSync(path.join(dir, relative))) store(`upstream/native/${component.name}/provenance/${relative}`, fs.readFileSync(path.join(dir, relative)), { component: component.name, url: `https://raw.githubusercontent.com/${component.repository}/${component.ref}/${relative}`, purpose: 'Source dependency / generated-data provenance, not another license' })
    }
    console.log(`Preserved native notices: ${component.name}`)
  })
  for (const [name, url, license, usage] of [
    ['CC0-1.0.txt', 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt', 'CC0-1.0', 'libsodium Argon2 and BLAKE2 source headers'],
    ['Unicode-3.0.txt', 'https://www.unicode.org/license.txt', 'Unicode-3.0', 'Unicode Character Database used by libnormalize and libidna']
  ]) {
    store(`upstream/licenses/${name}`, await get(url), { component: license, url })
    components.push({ name: license, license, usedBy: usage, source: url, note: 'Official full legal text frozen with SHA-256; see README for Unicode build-version limitation' })
  }
  const evidenceUrl = 'https://api.github.com/repos/holepunchto/noise-curve-ed/git/trees/v2.1.0?recursive=1'
  store('upstream/npm/noise-curve-ed@2.1.0/UPSTREAM-TREE.json', await get(evidenceUrl), { package: 'noise-curve-ed@2.1.0', url: evidenceUrl, purpose: 'Evidence of missing LICENSE at the official release tag' })
  files.sort((a, b) => a.file.localeCompare(b.file, 'en'))
  packageSources.sort((a, b) => a.package.localeCompare(b.package, 'en'))
  const frozen = { schemaVersion: 1, reviewDate: '2026-09-14', packages: packages.map(item => `${item.name}@${item.version}`), packageSources, components, files }
  fs.writeFileSync(path.join(base, 'upstream-sources.json'), JSON.stringify(frozen, null, 2) + '\n')
  console.log(`Frozen ${files.length} original documents; review before running generate-notices.cjs. Source scratch directory retained for inspection: ${temporary}`)
}

refresh().catch(error => { console.error(error.message); process.exitCode = 1 })
