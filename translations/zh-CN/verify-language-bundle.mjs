// Assert that the production package preserves every original offline language plus Chinese.
import { readFile, readdir } from 'node:fs/promises'
import { DE } from '../../ui/src/i18n/de.ts'
import { ES } from '../../ui/src/i18n/es.ts'
import { FR } from '../../ui/src/i18n/fr.ts'
import { JA } from '../../ui/src/i18n/ja.ts'
const dir = new URL('../../ui/dist/assets/', import.meta.url)
const js = (await Promise.all((await readdir(dir)).filter(f => f.endsWith('.js')).map(f => readFile(new URL(f, dir), 'utf8')))).join('\n')
for (const [locale, catalog] of Object.entries({ de: DE, es: ES, fr: FR, ja: JA })) {
  const sentinels = Object.values(catalog).filter(v => typeof v === 'string' && v.length > 70 && !/["'\\\n]/.test(v)).slice(0, 4)
  if (sentinels.length < 3) throw new Error(`Insufficient controls for ${locale}`)
  if (!sentinels.every(text => js.includes(text))) throw new Error(`Original offline ${locale} catalog missing from production bundle`)
}
const data = JSON.parse(await readFile(new URL('nexus-zh-CN.json', import.meta.url), 'utf8'))
const chinese = data.rows.find(row => row.id === 'logbook.field.parkMine.title').chinese
if (!js.includes(chinese)) throw new Error('Reviewed Chinese missing from production bundle')
console.log('Chinese, German, Spanish, French and Japanese catalog controls present in production JS.')
