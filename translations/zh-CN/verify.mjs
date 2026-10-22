// Validate against the live English catalog; never mistake a filled draft for a reviewed locale.
import { readFile } from 'node:fs/promises'
import { EN } from '../../ui/src/i18n/en.ts'

const data = JSON.parse(await readFile(new URL('nexus-zh-CN.json', import.meta.url), 'utf8'))
const overrides = JSON.parse(await readFile(new URL('reviewed-overrides.json', import.meta.url), 'utf8'))
const expected = new Map()
for (const [key, value] of Object.entries(EN)) {
  if (typeof value === 'string') expected.set(key, value)
  else for (const [form, text] of Object.entries(value)) expected.set(`${key}::${form}`, text)
}
const html = await readFile(new URL('../../ui/public/splashscreen.html', import.meta.url), 'utf8')
const splash = JSON.parse(html.match(/id="splash-strings"[^>]*>([\s\S]*?)<\/script>/)[1]).en
for (const [key, text] of Object.entries(splash)) expected.set(`splashscreen.${key}`, text)
const rows = new Map()
const problems = []
const markers = text => [...text.matchAll(/\{\{\w+\}\}|(?<!\{)\{[A-Z][A-Z0-9_]*\}(?!\})|<\/?[A-Za-z][A-Za-z0-9]*>/g)].map(m => m[0]).sort()
const invariant = text => [...text.matchAll(/\b(?:FT8|FT4|CW|RTTY|PSK31|JS8|SSTV|APRS|ADIF|CAT|PTT|VFO|RST|QSO|QSL|QTH|UTC|LoTW|QRZ|POTA|SOTA|DXCC|MHz|kHz|Hz|WPM)\b/g)].map(m => m[0]).sort()
function check(english, chinese) {
  return JSON.stringify(markers(english)) === JSON.stringify(markers(chinese)) &&
    JSON.stringify(invariant(english)) === JSON.stringify(invariant(chinese)) && !/\d,\d|\\u[0-9a-f]{4}/i.test(chinese)
}
// Positive controls: a guard that cannot reject a broken placeholder is not verification.
if (check('Grid {{grid}}', '网格 {{locator}}') || check('Frequency 14.074 MHz', '频率 14,074 MHz') || check('CW {NAME}', 'CW {姓名}')) {
  throw new Error('Guard failed its rejection control')
}
if (!check('Grid {{grid}}', '网格 {{grid}}')) throw new Error('Guard failed its acceptance control')
for (const row of data.rows) {
  if (rows.has(row.id)) problems.push(`Duplicate: ${row.id}`)
  rows.set(row.id, row)
  if (expected.get(row.id) !== row.english) problems.push(`Missing or changed English: ${row.id}`)
  if (!['untranslated', 'draft', 'reference', 'reviewed'].includes(row.status)) problems.push(`Invalid status: ${row.id}`)
  if (row.chinese && !check(row.english, row.chinese)) problems.push(`Placeholder/token mismatch: ${row.id}`)
  if (row.status === 'reviewed' && !row.chinese.trim()) problems.push(`Blank reviewed row: ${row.id}`)
}
for (const id of expected.keys()) if (!rows.has(id)) problems.push(`Missing row: ${id}`)
// An ignored review used to leave a compatible old machine draft behind, so the ordinary
// catalog checks passed. Verify the explicit review itself and its actual generated result.
for (const [id, review] of Object.entries(overrides)) {
  if (expected.get(id) !== review.english) problems.push(`Stale or unknown reviewed override: ${id}`)
  if (!review.chinese?.trim() || !check(review.english, review.chinese)) {
    problems.push(`Invalid reviewed override: ${id}`)
  }
  const row = rows.get(id)
  if (row?.chinese !== review.chinese || row?.status !== 'reviewed') {
    problems.push(`Reviewed override not applied: ${id}`)
  }
}
const counts = Object.fromEntries(['untranslated', 'draft', 'reference', 'reviewed'].map(s => [s, data.rows.filter(r => r.status === s).length]))
if (process.argv.includes('--require-complete') && counts.reviewed !== expected.size) problems.push(`Not ready to package: ${counts.reviewed}/${expected.size} rows reviewed`)
console.log(JSON.stringify({ expected: expected.size, actual: data.rows.length, counts, problems }, null, 2))
if (problems.length) process.exitCode = 1
