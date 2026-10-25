// Actual shell control rendering and command wiring, not Android lifecycle/RF or pixel proof.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { AndroidPanelBar } from './AndroidPanelBar'
import { StationControlContext } from '../stationAccess'
import { closePanelWindow, haltTx } from '../api'
import { subscribeToasts, dismissToast, type Toast } from '../toast'
import { t } from '../i18n'
import type { AppSnapshot } from '../types'
import { css, loadSheets } from '../cssCascade.testkit'

vi.mock('../api', () => ({ closePanelWindow: vi.fn(), haltTx: vi.fn() }))

beforeAll(() => loadSheets(['styles.css', 'cockpit-panes.css']))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(closePanelWindow).mockResolvedValue(undefined)
  vi.mocked(haltTx).mockResolvedValue({} as AppSnapshot)
  window.history.replaceState({}, '', '/?panel=needed&androidPanel=1')
})
afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

it('adds no mobile controls to the original desktop panel route', () => {
  window.history.replaceState({}, '', '/?panel=needed')
  const { container } = render(<AndroidPanelBar />)
  expect(container.childElementCount).toBe(0)
})

it('closes exactly the current panel and never changes modes or the main document', async () => {
  render(<AndroidPanelBar />)
  fireEvent.click(screen.getByRole('button', { name: t('android.panel.back') }))
  await waitFor(() => expect(closePanelWindow).toHaveBeenCalledExactlyOnceWith('needed'))
  expect(window.location.search).toBe('?panel=needed&androidPanel=1')
  expect(haltTx).not.toHaveBeenCalled()
})

it('Stop remains usable while an ordinary close command is pending', async () => {
  vi.mocked(closePanelWindow).mockReturnValue(new Promise(() => {}))
  render(<AndroidPanelBar />)
  fireEvent.click(screen.getByRole('button', { name: t('android.panel.back') }))
  const stop = screen.getByRole('button', { name: 'Stop TX' })
  expect(stop.hasAttribute('disabled')).toBe(false)
  fireEvent.click(stop)
  await waitFor(() => expect(haltTx).toHaveBeenCalledExactlyOnceWith())
})

it('uses Stop authority rather than granting control from the route', () => {
  render(<StationControlContext.Provider value={false}><AndroidPanelBar /></StationControlContext.Provider>)
  const stop = screen.getByRole('button', { name: 'Stop TX' })
  expect(stop.hasAttribute('disabled')).toBe(true)
  fireEvent.click(stop)
  expect(haltTx).not.toHaveBeenCalled()
})

it('reports failed Stop and close without an unhandled rejection', async () => {
  let messages: Toast[] = []
  const unsubscribe = subscribeToasts((next) => { messages = next })
  vi.mocked(haltTx).mockRejectedValue(new Error('native stop refused'))
  vi.mocked(closePanelWindow).mockRejectedValue(new Error('page is gone'))
  render(<AndroidPanelBar />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop TX' }))
  fireEvent.click(screen.getByRole('button', { name: t('android.panel.back') }))
  await waitFor(() => expect(haltTx).toHaveBeenCalledTimes(1))
  await waitFor(() => {
    expect(messages.some((toast) => toast.kind === 'error' && toast.message.includes('native stop refused'))).toBe(true)
    expect(messages.some((toast) => toast.kind === 'error' && toast.message.includes('page is gone'))).toBe(true)
  })
  unsubscribe()
  for (const toast of messages) dismissToast(toast.id)
})

it('computes the actual non-shrinking shell bar and zoom-aware touch floors', () => {
  const { container } = render(<AndroidPanelBar />)
  const bar = container.firstElementChild!
  expect(css(bar, 'display')).toBe('flex')
  expect(css(bar, 'flex')).toBe('0 0 auto')
  for (const button of bar.querySelectorAll('button')) {
    expect(css(button, 'min-height')).toContain('48px')
    expect(css(button, 'min-width')).toContain('48px')
  }
})

it('every detached renderer gets this bar inside the zoomed shell, before removable content', () => {
  const source = readFileSync(new URL('../DetachedPanel.tsx', import.meta.url), 'utf8')
  const shell = source.slice(source.indexOf('function DetachedShell('), source.indexOf('const CONTEST_ESC_STOP_PANELS'))
  expect(shell.indexOf('<AndroidPanelBar />')).toBeGreaterThan(shell.indexOf('<div className='))
  expect(shell.indexOf('<AndroidPanelBar />')).toBeLessThan(shell.indexOf('{children}'))
  expect(shell).toContain('<Toasts />')
})