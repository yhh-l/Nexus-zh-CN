import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rustLicenseText } from './rust-license-source'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-notice-source-'))
  roots.push(directory)
  const root = pathToFileURL(directory + '/')
  mkdirSync(new URL('licenses/rust/', root), { recursive: true })
  mkdirSync(new URL('target/android-notices/', root), { recursive: true })
  writeFileSync(new URL('licenses/rust/THIRD-PARTY.txt', root), 'desktop fixture\n')
  const text = 'Android fixture — exact bytes\n'
  writeFileSync(new URL('target/android-notices/RUST-THIRD-PARTY.txt', root), text)
  const env = { NEXUS_ANDROID_RUST_NOTICES: '1', GITHUB_ACTIONS: 'true', GITHUB_SHA: 'a'.repeat(40) }
  const report = { schemaVersion: 1, sourceRevision: env.GITHUB_SHA, target: 'aarch64-linux-android',
    features: ['radio', 'yaesu-wf', 'tauri/custom-protocol'], rustNoticeGenerationComplete: true,
    problems: [], noticeBytes: Buffer.byteLength(text), noticeSha256: createHash('sha256').update(text).digest('hex') }
  const save = () => writeFileSync(new URL('target/android-notices/rust-report.json', root), JSON.stringify(report))
  save()
  return { root, text, report, save, env }
}

describe('Rust notices used by the real Vite asset emitter', () => {
  it('preserves desktop input without an explicit Android selection', () => {
    const { root } = fixture()
    expect(rustLicenseText(root, {})).toBe('desktop fixture\n')
  })
  it('selects only the exact validated Android inventory', () => {
    const { root, text, env } = fixture()
    expect(rustLicenseText(root, env)).toBe(text)
  })
  it('refuses unreviewed selector, non-cloud or unknown build revision', () => {
    const { root, env } = fixture()
    for (const change of [{ NEXUS_ANDROID_RUST_NOTICES: 'other' }, { GITHUB_ACTIONS: 'false' }, { GITHUB_SHA: '' }]) {
      expect(() => rustLicenseText(root, { ...env, ...change })).toThrow(/exact cloud/)
    }
  })
  it('does not substitute desktop text for stale, failed or wrong-graph inventories', () => {
    for (const change of [{ sourceRevision: 'b'.repeat(40) }, { target: 'x86_64-pc-windows-gnu' },
      { features: ['radio'] }, { problems: ['missing text'] }, { rustNoticeGenerationComplete: false },
      { noticeBytes: 1 }, { noticeSha256: '0'.repeat(64) }]) {
      const { root, report, env, save } = fixture()
      Object.assign(report, change)
      save()
      expect(() => rustLicenseText(root, env)).toThrow(/mismatched Android/)
    }
  })
  it('refuses changed or absent Android text instead of falling back', () => {
    const { root, env } = fixture()
    const file = new URL('target/android-notices/RUST-THIRD-PARTY.txt', root)
    writeFileSync(file, 'substituted desktop text\n')
    expect(() => rustLicenseText(root, env)).toThrow(/mismatched Android/)
    rmSync(file)
    expect(() => rustLicenseText(root, env)).toThrow()
  })
})
