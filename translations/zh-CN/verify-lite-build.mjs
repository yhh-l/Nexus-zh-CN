// Assert that tree shaking removed foreign catalogs, rather than merely hiding menu choices.
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
  if (sentinels.some(text => js.includes(text))) throw new Error(`Unused ${locale} catalog remains in the production bundle`)
}
const data = JSON.parse(await readFile(new URL('nexus-zh-CN.json', import.meta.url), 'utf8'))
const chinese = data.rows.find(row => row.id === 'logbook.field.parkMine.title').chinese
if (!js.includes(chinese)) throw new Error('Reviewed Chinese missing from production bundle')
console.log('Chinese present; German, Spanish, French and Japanese catalog controls absent from production JS.')
