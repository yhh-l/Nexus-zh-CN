// Build-time source selection only. Never fetch notices or silently use desktop
// text for an explicitly selected Android build. Runtime display is unchanged.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function rustLicenseText(root: URL, env: Record<string, string | undefined> = process.env): string {
  const selected = env.NEXUS_ANDROID_RUST_NOTICES
  if (selected === undefined) return readFileSync(new URL('licenses/rust/THIRD-PARTY.txt', root), 'utf8')
  if (selected !== '1' || env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) {
    throw new Error('Android Rust notices require the exact cloud build revision')
  }
  const report = JSON.parse(readFileSync(new URL('target/android-notices/rust-report.json', root), 'utf8'))
  const text = readFileSync(new URL('target/android-notices/RUST-THIRD-PARTY.txt', root), 'utf8')
  const features = ['radio', 'tauri/custom-protocol', 'yaesu-wf']
  if (report.schemaVersion !== 1 || report.sourceRevision !== env.GITHUB_SHA ||
      report.target !== 'aarch64-linux-android' || report.rustNoticeGenerationComplete !== true ||
      !Array.isArray(report.features) || JSON.stringify([...report.features].sort()) !== JSON.stringify(features) ||
      !Array.isArray(report.problems) || report.problems.length !== 0 ||
      report.noticeBytes !== Buffer.byteLength(text, 'utf8') ||
      report.noticeSha256 !== createHash('sha256').update(text, 'utf8').digest('hex')) {
    throw new Error('Missing, stale or mismatched Android Rust notice evidence')
  }
  return text
}
