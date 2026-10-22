// Run on the Windows runner against the INSTALLED app's actual WebView2, never a Vite preview.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

if (process.platform !== 'win32') throw new Error('This check requires the installed Windows app')
const out = process.argv[2] ?? 'smoke-results'
await mkdir(out, { recursive: true })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = Date.now() + 120_000
let socket
let call
let nextId = 0
const pending = new Map()
try {
  while (Date.now() < deadline && !socket) {
    try {
      const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json()
      const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl && !/blank\.html|splashscreen\.html|devtools:/.test(p.url))
      if (page) socket = new WebSocket(page.webSocketDebuggerUrl)
    } catch { /* WebView2 has not opened yet. */ }
    if (!socket) await pause(500)
  }
  if (!socket) throw new Error('Installed app did not expose a main WebView2 page within 120 seconds')
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const r = JSON.parse(event.data)
    const p = pending.get(r.id)
    if (!p) return
    pending.delete(r.id); clearTimeout(p.timer)
    if (r.error) p.reject(new Error(JSON.stringify(r.error)))
    else p.resolve(r.result)
  })
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 15_000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const snapshots = []
  for (const locale of ['en', 'zh-CN']) {
    await evaluate(`localStorage.setItem('nexus.locale', ${JSON.stringify(locale)})`)
    await call('Page.reload', { ignoreCache: true })
    let text = ''
    for (let i = 0; i < 180; i++) {
      try { text = await evaluate('document.querySelector("#root")?.innerText ?? ""') } catch { text = '' }
      if (text.length > 80 && (locale === 'en' || (text.match(/[\u4e00-\u9fff]/g) ?? []).length >= 20)) break
      await pause(500)
    }
    if (text.length < 80) throw new Error(`${locale}: native main UI stayed blank`)
    if (locale === 'zh-CN' && (text.match(/[\u4e00-\u9fff]/g) ?? []).length < 20) throw new Error('Installed main UI did not render Chinese')
    if (/\{\{\w+\}\}/.test(text)) throw new Error(`${locale}: unresolved interpolation in visible UI`)
    if (locale === 'zh-CN' && text === snapshots[0].text) throw new Error('Changing the locale did not change the installed UI')
    const screenshot = await call('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(out, `${locale}.png`), Buffer.from(screenshot.data, 'base64'))
    await writeFile(join(out, `${locale}.txt`), text)
    snapshots.push({ locale, text })
  }
  const result = { checkedAt: new Date().toISOString(), platform: process.platform,
    checks: ['Installed Windows executable main WebView2 loaded', 'English and Chinese rendered with different text', 'No visible unresolved interpolation', 'Screenshots captured'],
    samples: snapshots.map(({ locale, text }) => ({ locale, characters: text.length })),
    limits: 'No radio connected; no RF, audio, decoding or real operator PC validation.' }
  await writeFile(join(out, 'windows-smoke.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Check stopped')) }
  socket?.close()
}
