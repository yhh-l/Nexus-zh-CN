// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN, getLocale, initLocale, installCatalog, LOCALE_KEY, setLocale, t } from './index'
import { ZH_CN } from './zh-CN'
import { LOCALE_NATIVE_NAME } from './useLocale'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setLocale('en') })

describe('Simplified Chinese integration', () => {
  it('ships every reviewed key, with all English plural forms', () => {
    expect(Object.keys(ZH_CN).sort()).toEqual(Object.keys(EN).sort())
    for (const key of Object.keys(EN) as (keyof typeof EN)[]) {
      if (typeof EN[key] === 'object') expect(Object.keys(ZH_CN[key]).sort()).toEqual(Object.keys(EN[key]).sort())
    }
    expect(LOCALE_NATIVE_NAME['zh-CN']).toBe('简体中文')
  })

  it.each([
    ['zh-CN', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh-Hans', 'zh-CN'],
    ['zh-Hans-HK', 'zh-CN'], ['zh-TW', 'en'], ['zh-Hant-CN', 'en'], ['zh', 'en'],
  ])('app and splash agree for %s', (os, expected) => {
    installCatalog('zh-CN', ZH_CN)
    setLocale('en'); localStorage.clear()
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(os)
    initLocale()
    expect(getLocale()).toBe(expected)
    const html = readFileSync(resolve(process.cwd(), 'public/splashscreen.html'), 'utf8')
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
    const code = [...document.querySelectorAll('script:not([type])')].map(s => s.textContent).join('\n')
    new Function(code)()
    ;(window as unknown as { nexusSplash: { show: (note: unknown) => void } }).nexusSplash.show({ state: 'opening' })
    expect(document.documentElement.lang).toBe(expected)
  })

  it('persists an explicit Chinese choice and keeps numbers invariant', () => {
    installCatalog('zh-CN', ZH_CN)
    setLocale('zh-CN')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-TW')
    initLocale()
    expect(getLocale()).toBe('zh-CN')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('zh-CN')
    expect(t('logbook.field.parkMine.title')).toBe(ZH_CN['logbook.field.parkMine.title'])
    const key = Object.keys(ZH_CN).find(k => typeof ZH_CN[k as keyof typeof ZH_CN] === 'object') as keyof typeof ZH_CN
    const text = t(key, { count: 150214 })
    expect(text).not.toMatch(/\{\{count\}\}|150,214/)
    setLocale('en')
    expect(t('logbook.field.parkMine.title')).toBe(EN['logbook.field.parkMine.title'])
  })
})
