// @vitest-environment jsdom
// Real Logbook inputs and production error/toast boundary. Browser File/provider
// reads and native API calls are controlled; this is NOT Android chooser/JNI proof.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Logbook } from './Logbook'
import * as api from '../api'
import { dismissToast, subscribeToasts, type Toast } from '../toast'
import { t } from '../i18n'
import type { LogQuestion } from '../features/logAnswers'

vi.mock('../api', () => {
  const noop = () => vi.fn()
  return {
    askLog: vi.fn(async (question: LogQuestion) => (await import('../features/logAnswers.testkit')).answerAs(question, [])),
    logOperators: vi.fn(async () => []), logActivations: vi.fn(async () => []), lotwSatNames: vi.fn(async () => []),
    importAdif: vi.fn(async () => ({ added: 1, skipped: 0, updated: 0, total: 1 })),
    syncLotwReport: vi.fn(async () => ({ newlyConfirmed: 1, newlyCredited: 0, orphans: [] })),
    importPotaLog: vi.fn(async () => ({ stamped: 1, unmatched: 0, already: 0 })),
    deleteQsoById: noop(), editQsoById: noop(), exportGeneralLog: noop(), exportSelectedLog: noop(),
    exportLogForOperator: noop(), exportLogForActivation: noop(), saveTextToDownloads: noop(),
    logQso: noop(), markQslSentById: noop(), markQslCardById: noop(), setSatTagById: noop(),
    purgeLog: noop(), qrzLookup: noop(), uploadLotwReport: noop(), qrzPushQso: noop(),
    clublogPushQso: noop(), hrdlogPushQso: noop(), wrlPushQso: noop(),
  }
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let messages: readonly Toast[] = []
let unsubscribe: () => void
beforeEach(() => {
  vi.clearAllMocks()
  unsubscribe = subscribeToasts((toasts) => { messages = toasts })
  for (const toast of [...messages]) dismissToast(toast.id)
})
afterEach(() => {
  cleanup()
  for (const toast of [...messages]) dismissToast(toast.id)
  unsubscribe()
})

function inputs() {
  const { container } = render(<Logbook defaultBand="20m" defaultFreqMhz={14.074} defaultMode="FT8" />)
  return [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')]
}
function document(read: () => Promise<string>) {
  // File.text is browser/OS authority, not a guessed filesystem path for content://.
  const file = new File([], 'station.adi', { type: 'application/octet-stream' })
  Object.defineProperty(file, 'text', { value: vi.fn(read) })
  return file
}

it('keeps all three document inputs unfiltered across provider MIME labels', () => {
  const pickers = inputs()
  expect(pickers).toHaveLength(3)
  for (const input of pickers) {
    expect(input.hasAttribute('accept')).toBe(false)
    expect(input.accept).toBe('')
    expect(input.disabled).toBe(false)
  }
})

const routes = [
  { index: 0, command: 'importAdif', failure: 'logbook.import.failed' },
  { index: 1, command: 'syncLotwReport', failure: 'logbook.sync.failed' },
  { index: 2, command: 'importPotaLog', failure: 'logbook.pota.failed' },
] as const

for (const route of routes) {
  it(`${route.command}: reads the selected document unchanged and invokes only its original native route`, async () => {
    const input = inputs()[route.index]
    const text = '<CALL:6>BG0AAA<COMMENT:6>你好<EOR>\r\n'
    const file = document(async () => text)
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(api[route.command]).toHaveBeenCalledWith(text))
    expect(file.text).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('') // same document can be selected for a later retry.
    for (const other of routes.filter((item) => item.index !== route.index)) expect(api[other.command]).not.toHaveBeenCalled()
    expect(messages.some((toast) => toast.kind === 'error')).toBe(false)
  })

  it(`${route.command}: reports unreadable provider data without invoking any log mutation`, async () => {
    const input = inputs()[route.index]
    fireEvent.change(input, { target: { files: [document(async () => { throw new Error('document access revoked') })] } })
    await waitFor(() => expect(messages.some((toast) => toast.kind === 'error' &&
      toast.message.includes(t(route.failure)) && toast.message.includes('document access revoked'))).toBe(true))
    for (const other of routes) expect(api[other.command]).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })
}

it('cancelling each chooser performs no read, mutation or success notification', async () => {
  for (const input of inputs()) fireEvent.change(input, { target: { files: [] } })
  await Promise.resolve()
  for (const route of routes) expect(api[route.command]).not.toHaveBeenCalled()
  expect(messages).toHaveLength(0)
})
