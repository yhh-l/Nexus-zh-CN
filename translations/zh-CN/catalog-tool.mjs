// Local translation inventory. Node 24; no network calls or extra dependencies.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { EN } from '../../ui/src/i18n/en.ts'

const dir = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../../', import.meta.url))
const terms = JSON.parse(await readFile(new URL('terms.json', import.meta.url), 'utf8'))
const keyTerms = JSON.parse(await readFile(new URL('key-overrides.json', import.meta.url), 'utf8'))
const reviewedOverrides = JSON.parse(await readFile(new URL('reviewed-overrides.json', import.meta.url), 'utf8'))
const reviewedBatches = JSON.parse(await readFile(new URL('reviewed-batches.json', import.meta.url), 'utf8'))
let machineTranslations = {}
try { machineTranslations = JSON.parse(await readFile(new URL('machine-translations.json', import.meta.url), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
const args = process.argv.slice(2)
const references = new Map()
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--reference') throw new Error(`Unknown option: ${args[i]}`)
  const ref = JSON.parse(await readFile(args[++i], 'utf8'))
  for (const pair of ref.pairs) {
    // Only short captions are reference candidates. Long third-party prose is not imported.
    if (pair.english.length > 60 || pair.chinese.length > 60) continue
    const found = references.get(pair.english) ?? []
    found.push({ chinese: pair.chinese, url: ref.url, context: pair.context })
    references.set(pair.english, found)
  }
}

const slots = text => [...text.matchAll(/\{\{\w+\}\}|(?<!\{)\{[A-Z][A-Z0-9_]*\}(?!\})|<\/?[A-Za-z][A-Za-z0-9]*>/g)].map(m => m[0]).sort()
const invariant = text => [...text.matchAll(/\b(?:FT8|FT4|CW|RTTY|PSK31|JS8|SSTV|APRS|ADIF|CAT|PTT|VFO|RST|QSO|QSL|QTH|UTC|LoTW|QRZ|POTA|SOTA|DXCC|MHz|kHz|Hz|WPM)\b/g)].map(m => m[0]).sort()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function compatible(english, chinese) {
  return same(slots(english), slots(chinese)) && same(invariant(english), invariant(chinese)) && !/\d,\d|\\u[0-9a-f]{4}/i.test(chinese)
}
let previous = { rows: [] }
try { previous = JSON.parse(await readFile(new URL('nexus-zh-CN.json', import.meta.url), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
const old = new Map(previous.rows.map(row => [row.id, row]))
const rows = []
for (const [key, entry] of Object.entries(EN)) {
  const forms = typeof entry === 'string' ? [['', entry]] : Object.entries(entry)
  for (const [form, english] of forms) {
    const id = form ? `${key}::${form}` : key
    const prior = old.get(id)
    const reviewed = reviewedOverrides[id]
    const reviewBatch = Object.entries(reviewedBatches).find(([, ids]) => ids.includes(id))?.[0]
    let chinese = '', status = 'untranslated', source = ''
    if (reviewed?.english === english && reviewed.chinese && !compatible(english, reviewed.chinese)) {
      throw new Error(`Rejected reviewed override (placeholder/token mismatch): ${id}`)
    }
    if (reviewed?.english === english && reviewed.chinese && compatible(english, reviewed.chinese)) {
      chinese = reviewed.chinese; status = 'reviewed'; source = `模型语义校对第 ${reviewed.batch} 组（不代表第三方人工确认）`
    } else if (reviewBatch && prior?.english === english && prior.chinese && compatible(english, prior.chinese)) {
      chinese = prior.chinese; status = 'reviewed'; source = `模型语义校对第 ${reviewBatch} 组（不代表第三方人工确认）`
    } else if (keyTerms[id] && compatible(english, keyTerms[id])) {
      chinese = keyTerms[id]; status = 'draft'; source = '按界面键名编写的初译，需校对'
    } else if (prior?.english === english && prior.chinese && compatible(english, prior.chinese)) {
      ;({ chinese, status, source } = prior)
    } else if (terms[english] && compatible(english, terms[english])) {
      chinese = terms[english]; status = 'draft'; source = 'terms.json：本地中文初译，需按界面语境校对'
    } else if (machineTranslations[id] && compatible(english, machineTranslations[id])) {
      chinese = machineTranslations[id]; status = 'draft'; source = 'Argos Translate en→zh 机器初译，需人工校对'
    } else {
      const candidates = references.get(english) ?? []
      const values = [...new Set(candidates.map(c => c.chinese))]
      if (values.length === 1 && compatible(english, values[0])) {
        chinese = values[0]; status = 'reference'; source = candidates.map(c => `${c.url} (${c.context})`).join('\n')
      }
    }
    rows.push({ id, key, form, english, chinese, status, source, preserve: [...slots(english), ...invariant(english)] })
  }
}
// Include the independent launch page in the same review inventory.
const splash = await readFile(new URL('../../ui/public/splashscreen.html', import.meta.url), 'utf8')
const launch = JSON.parse(splash.match(/id="splash-strings"[^>]*>([\s\S]*?)<\/script>/)[1]).en
const launchZh = {
  title: '正在将交信日志迁移至新数据库',
  once: '此操作只需执行一次。完成后 Nexus 会自动打开。',
  count: '已处理 {{done}} / {{total}} 条交信记录',
  finishing: '正在完成…',
  opening: '正在打开 Nexus…',
}
for (const [key, english] of Object.entries(launch)) {
  const id = `splashscreen.${key}`
  const prior = old.get(id)
  const reviewed = reviewedOverrides[id]
  if (reviewed?.english === english && reviewed.chinese && !compatible(english, reviewed.chinese)) {
    throw new Error(`Rejected reviewed override (placeholder/token mismatch): ${id}`)
  }
  rows.push(reviewed?.english === english && reviewed.chinese ? {
    id, key: id, form: '', english, chinese: reviewed.chinese, status: 'reviewed',
    source: `模型语义校对第 ${reviewed.batch} 组（不代表第三方人工确认）`,
    preserve: [...slots(english), ...invariant(english)],
  } : prior?.english === english && prior.chinese && compatible(english, prior.chinese) ? prior : {
    id, key: id, form: '', english, chinese: launchZh[key], status: 'draft', source: '本地中文初译', preserve: slots(english),
  })
}
const meta = {
  commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  version: JSON.parse(await readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).version,
  keys: Object.keys(EN).length, messages: rows.length - Object.keys(launch).length,
  splash: Object.keys(launch).length, uniqueTexts: new Set(rows.map(r => r.english)).size,
  counts: Object.fromEntries(['untranslated', 'draft', 'reference', 'reviewed'].map(s => [s, rows.filter(r => r.status === s).length])),
  note: 'reviewed 为第一轮模型语义审核，不代表第三方人工验收；应用接入与构建状态见 README.md。',
}
await mkdir(dir, { recursive: true })
const data = { meta, rows }
const machineInventory = Object.fromEntries(rows
  .filter(row => row.source.startsWith('Argos Translate en→zh 机器初译') || (row.status === 'reviewed' && machineTranslations[row.id]))
  .map(row => [row.id, row.source.startsWith('Argos Translate en→zh 机器初译') ? row.chinese : machineTranslations[row.id]]))
await writeFile(new URL('machine-translations.json', import.meta.url), JSON.stringify(machineInventory, null, 2) + '\n')
await writeFile(new URL('nexus-zh-CN.json', import.meta.url), JSON.stringify(data, null, 2) + '\n')
const template = await readFile(new URL('review-template.html', import.meta.url), 'utf8')
await writeFile(new URL('中英文对照.html', import.meta.url), template.replace('/*CATALOG*/null', JSON.stringify(data).replaceAll('<', '\\u003c')))
console.log(JSON.stringify(meta, null, 2))
