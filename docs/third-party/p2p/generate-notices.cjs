#!/usr/bin/env node
// FreeCut original tooling, GPL-3.0-or-later. This does not relicense copied notices.
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const base = __dirname
const root = path.resolve(base, '../../..')
const slash = value => value.replaceAll('\\', '/')
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const safeName = name => name.replace(/^@/, '').replaceAll('/', '__')
const noticeName = /^(?:licen[cs]e|copying|notice|copyright|authors)(?:[.-].*)?$/i

function resolvePackage(name, from) {
  for (let at = from; ; at = path.dirname(at)) {
    const candidate = path.join(at, 'node_modules', name, 'package.json')
    if (fs.existsSync(candidate)) return path.dirname(candidate)
    if (path.dirname(at) === at) return null
  }
}

function inventory() {
  const lock = json(path.join(root, 'package-lock.json'))
  const found = new Map()
  function visit(dir) {
    if (found.has(dir)) return found.get(dir)
    const pkg = json(path.join(dir, 'package.json'))
    const installedPath = slash(path.relative(root, dir))
    const item = {
      name: pkg.name, version: pkg.version, license: pkg.license || null,
      repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || null,
      installedPath, integrity: lock.packages?.[installedPath]?.integrity || null,
      resolved: lock.packages?.[installedPath]?.resolved || null,
      directory: dir, edges: [], notices: []
    }
    found.set(dir, item)
    const names = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...Object.keys(pkg.peerDependencies || {})])
    for (const name of [...names].sort()) {
      const optional = name in (pkg.optionalDependencies || {}) || pkg.peerDependenciesMeta?.[name]?.optional === true
      const target = resolvePackage(name, dir)
      const kind = name in (pkg.dependencies || {}) ? 'dependency' : name in (pkg.optionalDependencies || {}) ? 'optionalDependency' : 'peerDependency'
      if (!target && !optional) throw new Error(`Missing ${kind} ${pkg.name} -> ${name}`)
      const child = target && visit(target)
      item.edges.push({ name, kind, optional, installed: Boolean(child), version: child?.version || null })
    }
    return item
  }
  const entry = resolvePackage('hyperdht', root)
  if (!entry) throw new Error('Run npm ci before collecting notices')
  visit(entry)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'))
}

function generate({ check = false } = {}) {
  const packages = inventory()
  const output = new Map()
  const frozenPath = path.join(base, 'upstream-sources.json')
  if (!fs.existsSync(frozenPath)) throw new Error('Run refresh-upstream.cjs first; upstream licenses must be reviewed and frozen')
  const frozen = json(frozenPath)
  for (const original of frozen.files) {
    const file = path.resolve(base, original.file)
    if (!file.startsWith(base + path.sep) || sha256(fs.readFileSync(file)) !== original.sha256) throw new Error(`Frozen upstream notice changed: ${original.file}`)
  }
  for (const item of packages) {
    const packageFolder = `npm/${safeName(item.name)}@${item.version}`
    for (const name of fs.readdirSync(item.directory).sort()) {
      if (!noticeName.test(name) || !fs.statSync(path.join(item.directory, name)).isFile()) continue
      const bytes = fs.readFileSync(path.join(item.directory, name))
      const destination = `${packageFolder}/${name}`
      output.set(destination, bytes)
      item.notices.push({ file: destination, source: `${item.installedPath}/${name}`, sha256: sha256(bytes) })
    }
    if (!item.notices.some(n => /licen[cs]e|copying/i.test(path.basename(n.file)))) {
      const bytes = fs.readFileSync(path.join(item.directory, 'package.json'))
      const destination = `${packageFolder}/package.json`
      output.set(destination, bytes)
      item.notices.push({ file: destination, source: `${item.installedPath}/package.json`, sha256: sha256(bytes), declarationOnly: true })
      item.reviewStatus = 'UNRESOLVED: upstream supplies an SPDX declaration but no full license/copyright notice'
    } else item.reviewStatus = 'License text preserved; see upstream source review for native components'
    for (const source of frozen.files.filter(source => source.package === `${item.name}@${item.version}`)) item.notices.push({ file: source.file, source: source.url || source.sourceArchive, sha256: source.sha256 })
    if (!frozen.packages.includes(`${item.name}@${item.version}`)) throw new Error(`Upstream notice review is stale for ${item.name}@${item.version}`)
    delete item.directory
  }
  const manifest = { schemaVersion: 1, entry: 'hyperdht@6.34.0', scope: 'Installed recursive production, optional and present peer dependencies; original license files plus fixed-source native notices', unresolved: packages.filter(p => p.reviewStatus.startsWith('UNRESOLVED')).map(p => `${p.name}@${p.version}`), packages, upstream: frozen.components, upstreamFiles: frozen.files }
  output.set('MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  const lines = ['# Installed P2P dependencies', '', 'Generated by `node docs/third-party/p2p/generate-notices.cjs`. Consult [README.md](README.md) for review limitations and native vendor details.', '', '| Package | Installed version | Declared license | Original notice |', '| --- | --- | --- | --- |']
  for (const item of packages) lines.push(`| ${item.name} | ${item.version} | ${item.license} | ${item.notices.map(n => `[${path.basename(n.file)}](${n.file})`).join(', ')}${item.reviewStatus.startsWith('UNRESOLVED') ? ' **UNRESOLVED**' : ''} |`)
  output.set('DEPENDENCIES.md', Buffer.from(lines.join('\n') + '\n'))
  for (const [relative, bytes] of output) {
    const destination = path.join(base, relative)
    if (check) {
      if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bytes)) throw new Error(`Outdated notice: ${relative}; regenerate after reviewing dependency changes`)
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, bytes)
    }
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${packages.length} installed packages, ${frozen.components.length} native/supplemental components, ${frozen.files.length} frozen upstream files. Unresolved license texts: ${manifest.unresolved.join(', ') || 'none'}.`)
  if (process.argv.includes('--strict') && manifest.unresolved.length) throw new Error('Unresolved upstream license text; this is not a fully cleared license review')
}

module.exports = { inventory, root, base, safeName, sha256, noticeName }
if (require.main === module) generate({ check: process.argv.includes('--check') })
