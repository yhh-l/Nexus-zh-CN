// @vitest-environment jsdom
// The narrow rail has ONE horizontal scroll owner, with Settings pinned outside.
// These guards render the real component and compute the real stylesheet cascade.
// Geometry below is injected to test scrolling arithmetic, NOT claimed as browser layout.
// Run in GitHub Actions only; physical S25 Ultra layout/interaction remains separate.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { ModeNav, ITEMS } from './ModeNav'
import { css, loadSheets } from '../cssCascade.testkit'
import type { FeatureId } from '../features/registry'
import { t } from '../i18n'

const ALL_ON = new Proxy({}, { get: () => true }) as Record<FeatureId, boolean>

function renderNav(overrides: Partial<ComponentProps<typeof ModeNav>> = {}) {
  const props: ComponentProps<typeof ModeNav> = {
    view: 'operate', mode: 'chat', enabled: ALL_ON, tier: 'FT8',
    onSelect: vi.fn(), onDigitalMode: vi.fn(), ...overrides,
  }
  const rendered = render(<ModeNav {...props} />)
  const strip = rendered.container.querySelector<HTMLDivElement>('.mode-nav-top')!
  return { ...rendered, props, strip }
}

function geometry(strip: HTMLDivElement, button: HTMLElement) {
  // Effective layout width 400, rendered at 50% UI zoom: the visible rect is 200.
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 400 })
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 200, 50))
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(280, 0, 60, 44))
  strip.scrollLeft = 70
  strip.scrollTop = 19
}

beforeAll(() => loadSheets(['styles.css']))
beforeEach(() => {
  // jsdom has no ResizeObserver. Keyboard focus opens the real Radix tooltip,
  // which also uses it, so install the browser-API fixture before every render.
  // The dedicated resize test overrides this with an observable callback.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  localStorage.clear()
  document.documentElement.setAttribute('data-viewport', 'xs')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-viewport')
})

describe('phone section navigation', () => {
  it.each(['xs', 'sm'])('has one bounded strip and pinned Settings at %s', (viewport) => {
    document.documentElement.setAttribute('data-viewport', viewport)
    const { container, strip } = renderNav()
    const nav = screen.getByRole('navigation')
    const settings = screen.getByRole('button', { name: t('nav.settings.label') })
    const pinned = container.querySelector('.mode-nav-bottom')!
    expect(css(nav, 'overflow-x')).toBe('hidden')
    expect(css(strip, 'overflow-x')).toBe('auto')
    expect(css(strip, 'overflow-y')).toBe('hidden')
    expect(parseFloat(css(strip, 'min-width') ?? '')).toBe(0)
    expect(strip.contains(settings)).toBe(false)
    expect(pinned.contains(settings)).toBe(true)
    expect(css(pinned, 'flex')).toBe('0 0 auto')
    for (const button of strip.querySelectorAll('button.mode-btn')) {
      expect(css(button, 'width')).toBe('auto')
    }
    for (const source of strip.querySelectorAll('.mode-nav-drag button')) {
      expect(source.getAttribute('draggable')).toBe('false')
    }
  })

  it('keeps every enabled section, stored order and existing callbacks', () => {
    const saved = JSON.stringify(['logbook', 'awards', 'connect'])
    localStorage.setItem('nexus.navOrder', saved)
    const { props, strip } = renderNav()
    for (const item of ITEMS) expect(screen.getByRole('button', { name: item.title })).toBeTruthy()
    const labels = [...strip.querySelectorAll('.mode-nav-drag .mode-label')].map((e) => e.textContent)
    expect(labels.slice(0, 3)).toEqual(ITEMS.filter((i) => ['logbook', 'awards', 'connect'].includes(i.id))
      .sort((a, b) => ['logbook', 'awards', 'connect'].indexOf(a.id) - ['logbook', 'awards', 'connect'].indexOf(b.id))
      .map((i) => i.label))
    fireEvent.scroll(strip)
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(props.onDigitalMode).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t('nav.logbook.title') }))
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('logbook')
    fireEvent.click(screen.getByRole('button', { name: t('nav.digital.ft.title') }))
    expect(props.onDigitalMode).toHaveBeenCalledExactlyOnceWith('digital')
    expect(localStorage.getItem('nexus.navOrder')).toBe(saved)
  })

  it('does not resurrect disabled sections', () => {
    renderNav({ enabled: { awards: false, rtty: false } as Record<FeatureId, boolean> })
    expect(screen.queryByRole('button', { name: t('nav.awards.title') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('nav.digital.rtty.title') })).toBeNull()
    expect(screen.getByRole('button', { name: t('nav.settings.label') })).toBeTruthy()
  })

  it('reveals an external section change using zoom-correct horizontal movement only', () => {
    const { props, strip, rerender } = renderNav()
    const logbook = screen.getByRole('button', { name: t('nav.logbook.title') })
    geometry(strip, logbook)
    rerender(<ModeNav {...props} view="logbook" />)
    expect(strip.scrollLeft).toBe(150)
    expect(strip.scrollTop).toBe(19)
    expect(logbook.getAttribute('aria-current')).toBe('page')
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(props.onDigitalMode).not.toHaveBeenCalled()
  })

  it('reveals keyboard focus without activating the section or scrolling the cockpit', () => {
    const { props, strip } = renderNav()
    const logbook = screen.getByRole('button', { name: t('nav.logbook.title') })
    geometry(strip, logbook)
    fireEvent.focus(logbook)
    expect(strip.scrollLeft).toBe(150)
    expect(strip.scrollTop).toBe(19)
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(props.onDigitalMode).not.toHaveBeenCalled()
    // A focus event on an already visible item must not keep advancing the strip.
    vi.mocked(logbook.getBoundingClientRect).mockReturnValue(new DOMRect(160, 0, 60, 44))
    fireEvent.focus(logbook)
    expect(strip.scrollLeft).toBe(150)
  })

  it('ignores zero-sized first observations and follows a later resize', () => {
    let notify: (() => void) | undefined
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notify = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect() { disconnect() }
    })
    const { props, strip, unmount } = renderNav({ view: 'logbook' })
    expect(strip.scrollLeft).toBe(0)
    const logbook = screen.getByRole('button', { name: t('nav.logbook.title') })
    geometry(strip, logbook)
    act(() => notify?.())
    expect(strip.scrollLeft).toBe(150)
    expect(props.onSelect).not.toHaveBeenCalled()
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('preserves the desktop rail and desktop drag-to-reorder', () => {
    document.documentElement.setAttribute('data-viewport', 'md')
    const { strip, props } = renderNav()
    expect(css(screen.getByRole('navigation'), 'width')).toBe('88px')
    expect(css(screen.getByRole('navigation'), 'flex-direction')).toBe('column')
    expect(css(strip, 'overflow-y')).toBe('auto')
    for (const source of strip.querySelectorAll('.mode-nav-drag button')) {
      expect(source.getAttribute('draggable')).toBe('true')
    }
    expect(props.onSelect).not.toHaveBeenCalled()
  })
})
