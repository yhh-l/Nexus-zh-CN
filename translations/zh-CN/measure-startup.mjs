// Compare the production LAN entry on the same machine. This is not a radio/DSP benchmark.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { preview } from '../../ui/node_modules/vite/dist/node/index.js'
import { chrome } from '../../remote/test/browser-runtime.mjs'

const label = process.argv[2]
if (!['all-languages', 'zh-en'].includes(label)) throw new Error('Pass all-languages or zh-en')
const ui = fileURLToPath(new URL('../../ui/', import.meta.url))
const server = await preview({ root: ui, preview: { host: '127.0.0.1', port: 0 } })
let browser
try {
  browser = await chrome()
  const samples = []
  for (let run = 0; run < 3; run++) {
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.call('Target.attachToTarget', { targetId, flatten: true })
    const call = (method, params = {}) => browser.call(method, params, sessionId)
    const evaluate = async expression => {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
      return r.result.value
    }
    await call('Network.enable')
    await call('Network.setCacheDisabled', { cacheDisabled: true })
    await call('Emulation.setCPUThrottlingRate', { rate: 4 })
    await call('Performance.enable')
    await call('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/lan.html?lang=zh-CN` })
    let ready = false
    for (let i = 0; i < 200; i++) {
      ready = await evaluate('!!document.querySelector("h1") && document.readyState === "complete"')
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('LAN entry did not render')
    const page = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      resolve({heading: document.querySelector('h1').textContent,
        domContentLoadedMs: nav.domContentLoadedEventEnd,
        jsDecodedBytes: performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.endsWith('.js')).reduce((s,r) => s+r.decodedBodySize,0)});
    })))`)
    await call('HeapProfiler.collectGarbage')
    const heap = await call('Runtime.getHeapUsage')
    const metrics = Object.fromEntries((await call('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
    samples.push({ ...page, retainedJsHeapBytes: heap.usedSize, scriptDurationMs: metrics.ScriptDuration * 1000 })
    await browser.call('Target.closeTarget', { targetId })
  }
  const median = key => samples.map(s => s[key]).sort((a,b) => a-b)[1]
  const assets = new URL('../../ui/dist/assets/', import.meta.url)
  let totalJsBytes = 0
  for (const name of await readdir(assets)) if (name.endsWith('.js')) totalJsBytes += (await stat(new URL(name, assets))).size
  const result = { label, checkedAt: new Date().toISOString(), cpuThrottle: 4, cacheDisabled: true, samples,
    medians: Object.fromEntries(['domContentLoadedMs','jsDecodedBytes','retainedJsHeapBytes','scriptDurationMs'].map(k => [k,median(k)])), totalBuiltJsBytes: totalJsBytes,
    scope: 'Chrome production LAN entry on this Mac, three runs, retained JS heap after GC. No Windows, native memory, DSP, or real low-spec PC measurements.' }
  await writeFile(new URL(`reviews/startup-${label}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (browser) await browser.stop()
  await new Promise(resolve => server.httpServer.close(resolve))
}
