// Real Chrome smoke check of the production LAN entry and splash; no radio connection.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { preview } from '../../ui/node_modules/vite/dist/node/index.js'
import { chrome } from '../../remote/test/browser-runtime.mjs'

const ui = fileURLToPath(new URL('../../ui/', import.meta.url))
const rows = JSON.parse(await readFile(new URL('nexus-zh-CN.json', import.meta.url), 'utf8')).rows
const zhTitle = rows.find(row => row.id === 'lanWindow.title').chinese
const enTitle = rows.find(row => row.id === 'lanWindow.title').english
const server = await preview({ root: ui, preview: { host: '127.0.0.1', port: 0 } })
let browser
try {
  browser = await chrome()
  const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.call('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => browser.call(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const navigate = async path => {
    await call('Page.navigate', { url: origin + path })
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`location.pathname === ${JSON.stringify(path.split('?')[0])} && document.readyState === 'complete'`)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Page did not load')
  }
  const results = []
  // Start from an explicit English preference; an OS-default locale need not be persisted.
  await navigate('/lan.html?lang=en')
  await evaluate('localStorage.setItem("nexus.locale", "en")')
  for (const [width, height] of [[1024, 768], [1366, 768]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await navigate('/lan.html?lang=zh-CN')
    for (let i = 0; i < 100 && await evaluate('document.querySelector("h1")?.textContent') !== zhTitle; i++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await evaluate('document.querySelector("h1")?.textContent'), zhTitle)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
    assert.equal(await evaluate('localStorage.getItem("nexus.locale")'), 'zh-CN')
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    await writeFile(new URL(`reviews/integrated-zh-${width}.png`, import.meta.url), Buffer.from(shot.data, 'base64'))
    results.push({ surface: 'production LAN', width, height, heading: zhTitle, horizontalOverflow: false })
  }
  await navigate('/lan.html?lang=en')
  for (let i = 0; i < 100 && await evaluate('document.querySelector("h1")?.textContent') !== enTitle; i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await evaluate('document.querySelector("h1")?.textContent'), enTitle)
  await evaluate('localStorage.setItem("nexus.locale", "zh-CN")')
  await navigate('/splashscreen.html')
  await evaluate('window.nexusSplash.show({state:"converting",done:12,total:34})')
  assert.equal(await evaluate('document.documentElement.lang'), 'zh-CN')
  const count = await evaluate('document.querySelector(".count").textContent')
  assert.ok(count.includes('12') && count.includes('34'))
  results.push({ surface: 'production splash', count }, { surface: 'production LAN', switchBackToEnglish: true })
  await writeFile(new URL('reviews/integration-browser.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), results, scope: 'Browser frontend only; no native backend or Windows installer validation.' }, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
} finally {
  if (browser) await browser.stop()
  await new Promise(resolve => server.httpServer.close(resolve))
}
