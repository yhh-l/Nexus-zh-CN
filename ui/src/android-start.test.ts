// @vitest-environment jsdom
// This is the actual script-free startup page rendered into the DOM, not a
// mock app. jsdom verifies structure/cascade only; it proves no phone geometry.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Vite rewrites import.meta.url to an HTTP URL in jsdom. Read the real file
// relative to the UI package, like cssCascade.testkit, not through URL coercion.
const source = readFileSync(resolve(process.cwd(), 'public', 'android-start.html'), 'utf8')
let page: Document
let styles: HTMLStyleElement[]

beforeEach(() => {
  page = new DOMParser().parseFromString(source, 'text/html')
  document.body.innerHTML = page.body.innerHTML
  styles = [...page.querySelectorAll('style')].map(original => {
    const style = document.createElement('style')
    style.textContent = original.textContent
    document.head.appendChild(style)
    return style
  })
})
afterEach(() => {
  document.body.replaceChildren()
  for (const style of styles) style.remove()
})

describe('Android single-webview waiting page', () => {
  it('renders a named startup status and both initial-language labels', () => {
    const status = screen.getByRole('status', { name: 'Nexus' })
    expect(status.querySelector('h1')?.textContent).toBe('Nexus')
    expect(status.querySelector('[lang="zh-CN"]')?.textContent).toBe('正在启动')
    expect(status.querySelector('[lang="en"]')?.textContent).toBe('Starting')
    expect(page.title).toBe('Nexus')
  })

  it('cannot invoke the engine, navigate, submit or fetch remote startup content', () => {
    expect(page.querySelectorAll('script, iframe, object, embed, form, a, input, button, img, link').length).toBe(0)
    for (const node of page.querySelectorAll('*')) {
      for (const attribute of node.attributes) {
        expect(attribute.name.toLowerCase().startsWith('on')).toBe(false)
      }
    }
    expect(page.querySelector('meta[http-equiv="refresh"]')).toBeNull()
  })

  it('uses the real flexible page styles, without a desktop minimum width', () => {
    const main = screen.getByRole('status', { name: 'Nexus' })
    expect(getComputedStyle(document.body).display).toBe('grid')
    expect(parseFloat(getComputedStyle(main).minWidth)).toBe(0)
    expect(getComputedStyle(main).textAlign).toBe('center')
    expect(parseFloat(getComputedStyle(main).maxWidth)).toBeGreaterThan(0)
    expect(page.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      'width=device-width, initial-scale=1, viewport-fit=cover',
    )
  })
})
