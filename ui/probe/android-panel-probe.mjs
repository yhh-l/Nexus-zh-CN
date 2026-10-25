// Actual DetachedPanel + busy Spots renderer in real Chrome. Synthetic IPC only, never RF.
// This verifies CSS boxes/hit testing and real API wiring, NOT Android/Tauri/device lifecycle.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chrome, CHROME_COLD_START_MS } from '../../remote/test/browser-runtime.mjs'

const ui = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(ui, 'probe-artifacts/android-panel')
const cacheDir = await mkdtemp(join(tmpdir(), 'nexus-android-panel-'))
const server = await createServer({ root: ui, configFile: join(ui, 'vite.config.ts'), cacheDir,
  logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false } })
const report = []
let browser
let current
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const measure = `(() => {
  const app = document.querySelector('.app.detached')
  const bar = app?.querySelector(':scope > .android-panel-bar')
  if (!bar || !document.querySelector('.sp-grid .sp-row')) return null
  const holds = (outer, inner) => inner.left >= outer.left - .5 && inner.right <= outer.right + .5 &&
    inner.top >= outer.top - .5 && inner.bottom <= outer.bottom + .5
  const control = selector => {
    const button = bar.querySelector(selector)
    if (!button) return { reachable: false, reason: 'missing' }
    const r = button.getBoundingClientRect()
    let reason = r.width < 47.9 || r.height < 47.9 ? 'touch floor' : null
    if (!holds({left:0,top:0,right:innerWidth,bottom:innerHeight}, r)) reason = 'outside viewport'
    for (let parent = button.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent)
      const box = parent.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX) && (r.left < box.left - .5 || r.right > box.right + .5)) reason = 'clipped horizontally'
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY) && (r.top < box.top - .5 || r.bottom > box.bottom + .5)) reason = 'clipped vertically'
    }
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    if (!hit || !(hit === button || button.contains(hit))) reason = 'covered'
    return { reachable: reason === null, reason, width:r.width, height:r.height, x, y, disabled:button.disabled }
  }
  return { zoom: Number(getComputedStyle(app).zoom), back:control('.android-panel-back'),
    stop:control('.android-panel-stop'), rows:document.querySelectorAll('.sp-grid .sp-row').length }
})()`

async function open(width, height, query) {
  const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.call('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => browser.call(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true })
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false })
  await call('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/probe/spots.html?${query}` })
  await call('Page.bringToFront')
  return { call, evaluate, close: () => browser.call('Target.closeTarget', { targetId }) }
}

async function settled(page) {
  let last
  for (let i = 0; i < 100; i++) {
    const now = await page.evaluate(measure)
    if (now && JSON.stringify(last) === JSON.stringify(now)) return now
    last = now
    await sleep(150)
  }
  assert.fail('Actual Spots panel never settled with its native toolbar')
}

async function click(page, box) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.call('Input.dispatchMouseEvent', { type, x:box.x, y:box.y, button:'left', clickCount:1 })
  }
}

try {
  await mkdir(artifacts, { recursive:true })
  await server.listen()
  browser = await chrome([], CHROME_COLD_START_MS)
  for (const theme of ['dark', 'light']) {
    // Representative CSS viewports, not claims about any physical phone's density or OS.
    for (const [width, height] of [[360,740], [412,915], [915,412], [1280,800], [1920,1200]]) {
      for (const zoom of [65,175]) {
        const name = `${theme}-${width}x${height}-pin${zoom}`
        current = await open(width,height,`panel=spots&androidPanel=1&holdClose=1&theme=${theme}&zoom=${zoom}`)
        const result = await settled(current)
        report.push({ name, ...result })
        assert(result.rows > 0, `${name}: the original complete Spots renderer is missing`)
        assert(result.back.reachable && result.stop.reachable, `${name}: ${JSON.stringify(result)}`)
        assert(!result.stop.disabled, `${name}: Stop must not need a fresh ordinary command`)
        const before = await current.evaluate('window.__androidPanelCalls.length')
        await click(current,result.back)
        // Back deliberately remains pending at the synthetic bridge. Stop must still click.
        await click(current,result.stop)
        const calls = (await current.evaluate('window.__androidPanelCalls')).slice(before)
          .filter(c => !c.cmd.startsWith('get_') && c.cmd !== 'dxcc_entity_locations' && !c.cmd.startsWith('plugin:event|'))
        assert.deepEqual(calls.filter(c => c.cmd === 'close_panel_window'), [{cmd:'close_panel_window',args:{panel:'spots'}}])
        assert.equal(calls.filter(c => c.cmd === 'halt_tx').length,1)
        assert(calls.every(c => c.cmd === 'close_panel_window' || c.cmd === 'halt_tx'), 'Navigation must not retune or arm TX')
        const image = await current.call('Page.captureScreenshot', { format:'png' })
        await writeFile(join(artifacts,`${name}.png`),Buffer.from(image.data,'base64'))

        // Negative controls exercise the actual measured document, then restore it.
        await current.evaluate(`(() => {
          const cover = document.createElement('div'); cover.id = 'negative-panel-cover';
          Object.assign(cover.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'black'});
          document.body.appendChild(cover);
        })()`)
        assert.equal((await current.evaluate(measure)).stop.reachable,false,'Coverage detector must reject an actual overlay')
        await current.evaluate(`document.getElementById('negative-panel-cover').remove()`)
        const oldStyle = await current.evaluate(`(() => {
          const app = document.querySelector('.app.detached'); const style = app.getAttribute('style');
          app.style.height='1px';app.style.overflow='hidden';return style;
        })()`)
        assert.equal((await current.evaluate(measure)).stop.reachable,false,'Clipping detector must reject a clipped shell')
        await current.evaluate(`(() => {const app=document.querySelector('.app.detached'); const old=${JSON.stringify(oldStyle)};
          if(old===null)app.removeAttribute('style');else app.setAttribute('style',old)})()`)
        assert((await current.evaluate(measure)).stop.reachable,'Restoring the actual shell must restore Stop')
        await current.close()
        current = null
        console.log(`PASS ${name}: actual zoom ${result.zoom}, ${result.rows} rows, Back + Stop hit-tested; overlay/clipping controls rejected`)
      }
    }
  }
  assert(report.some(r => Math.abs(r.zoom-.65)<.01),'Must exercise the actual 65% floor')
  assert(report.some(r => Math.abs(r.zoom-1.75)<.01),'Must exercise an actual 175% pin where it fits')
  // Exact original desktop route: no native-only toolbar or changes to its shell chrome.
  current = await open(960,660,'panel=spots&theme=dark')
  for(let i=0;i<100;i++) {
    if(await current.evaluate(`Boolean(document.querySelector('.sp-grid .sp-row'))`)) break
    await sleep(150)
  }
  assert(await current.evaluate(`Boolean(document.querySelector('.sp-grid .sp-row'))`),'Desktop board must actually draw')
  assert.equal(await current.evaluate(`document.querySelector('.android-panel-bar')`),null)
  console.log('PASS original desktop panel route: complete board, no Android toolbar')
} catch (error) {
  if(current) {
    const image = await current.call('Page.captureScreenshot',{format:'png'}).catch(()=>null)
    if(image) await writeFile(join(artifacts,'failure.png'),Buffer.from(image.data,'base64'))
  }
  throw error
} finally {
  await writeFile(join(artifacts,'measurements.json'),JSON.stringify(report,null,2))
  await current?.close().catch(()=>{})
  await browser?.stop()
  await server.close()
  await rm(cacheDir,{recursive:true,force:true})
}