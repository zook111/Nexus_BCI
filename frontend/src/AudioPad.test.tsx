import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CalmAudioPadControls } from './App'

const contexts: MockContext[] = []
const media: MockAudio[] = []
let nextResume: Promise<void> | undefined
let nextPlay: Promise<void> | undefined
const now = 1_800_000_000_000
const feedback = { mode: 'calm' as const, label: 'Calm', score: .7, confidence: .8,
  signalState: 'usable' as const, title: 'Live', detail: '', driverLabel: '', driverValue: '', flags: [], hue: 160, features: [] }
const props = { feedback, voice: 'tide' as const, onVoiceChange: vi.fn(), sourceTimestamp: now / 1000 }

class Param {
  value = 0
  setTargetAtTime = vi.fn((value: number) => { this.value = value })
}
class Node {
  gain = new Param()
  frequency = new Param()
  type = 'sine'
  connect(node: Node) { return node }
  start = vi.fn()
  stop = vi.fn()
}
class MockContext {
  currentTime = 0
  destination = new Node()
  gains: Node[] = []
  constructor() { contexts.push(this) }
  createGain() { const node = new Node(); this.gains.push(node); return node }
  createBiquadFilter() { return new Node() }
  createOscillator() { return new Node() }
  resume = vi.fn(() => { const result = nextResume; nextResume = undefined; return result ?? Promise.resolve() })
  close = vi.fn(() => Promise.resolve())
}
class MockAudio {
  volume = 1
  loop = false
  preload = ''
  currentTime = 0
  paused = true
  src: string
  constructor(src: string) { this.src = src; media.push(this) }
  play = vi.fn(() => { this.paused = false; const result = nextPlay; nextPlay = undefined; return result ?? Promise.resolve() })
  pause = vi.fn(() => { this.paused = true })
}
function deferred() {
  let resolve = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function enable() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enable pad' })) }) }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); contexts.length = 0; media.length = 0
  nextResume = undefined; nextPlay = undefined
  vi.stubGlobal('AudioContext', MockContext); vi.stubGlobal('Audio', MockAudio)
})
afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('starts muted and opens only at or above the 55% gate with a finite score', async () => {
  const view = render(<CalmAudioPadControls {...props} feedback={{ ...feedback, confidence: .54 }} />)
  expect(contexts).toHaveLength(0)
  await enable()
  expect(contexts[0].gains[0].gain.value).toBe(0)
  view.rerender(<CalmAudioPadControls {...props} feedback={{ ...feedback, confidence: .55 }} />)
  expect(contexts[0].gains[0].gain.value).toBeGreaterThan(0)
  view.rerender(<CalmAudioPadControls {...props} feedback={{ ...feedback, score: NaN }} />)
  expect(contexts[0].gains[0].gain.value).toBe(0)
})

it('mutes noisy input and an explicit user mute disposes the engine', async () => {
  const view = render(<CalmAudioPadControls {...props} />)
  await enable()
  expect(contexts[0].gains[0].gain.value).toBeGreaterThan(0)
  view.rerender(<CalmAudioPadControls {...props} feedback={{ ...feedback, signalState: 'noisy' }} />)
  expect(contexts[0].gains[0].gain.value).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Mute pad' }))
  act(() => { vi.advanceTimersByTime(150) })
  expect(contexts[0].close).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Enable pad' })).toBeInTheDocument()
})

it.each(['tide', 'calm-trend'] as const)('closes %s when timestamps become stale and reopens on fresh data', async voice => {
  const view = render(<CalmAudioPadControls {...props} voice={voice} />)
  await enable()
  const level = () => voice === 'tide' ? contexts[0].gains[0].gain.value : media[0].volume
  expect(level()).toBeGreaterThan(0)
  act(() => { vi.advanceTimersByTime(2500) })
  expect(level()).toBe(0)
  expect(screen.getByText('closed', { exact: true })).toBeInTheDocument()
  view.rerender(<CalmAudioPadControls {...props} voice={voice} sourceTimestamp={(now + 2500) / 1000} />)
  expect(level()).toBeGreaterThan(0)
})

it('requires a live timestamp unless saved replay was explicitly selected', async () => {
  const view = render(<CalmAudioPadControls {...props} sourceTimestamp={null} />)
  await enable()
  expect(contexts[0].gains[0].gain.value).toBe(0)
  view.rerender(<CalmAudioPadControls {...props} sourceTimestamp={null} replay />)
  expect(contexts[0].gains[0].gain.value).toBeGreaterThan(0)
})

it('allows mute while AudioContext resume is pending without re-enabling on late success', async () => {
  const pending = deferred(); nextResume = pending.promise
  render(<CalmAudioPadControls {...props} />)
  await enable()
  fireEvent.click(screen.getByRole('button', { name: 'Mute pad' }))
  await act(async () => { pending.resolve() })
  expect(screen.getByRole('button', { name: 'Enable pad' })).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(150) })
  expect(contexts[0].close).toHaveBeenCalledOnce()
})

it('ignores a late old-loop failure after a different sound was enabled', async () => {
  const pending = deferred(); nextPlay = pending.promise
  const view = render(<CalmAudioPadControls {...props} voice="calm-trend" />)
  await enable()
  view.rerender(<CalmAudioPadControls {...props} voice="focus-tone" />)
  await enable()
  await act(async () => { pending.reject(new Error('old play failed')) })
  expect(media[1].pause).not.toHaveBeenCalled()
  expect(media[1].volume).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'Mute pad' })).toBeInTheDocument()
})

it('stops audio on view unmount', async () => {
  const view = render(<CalmAudioPadControls {...props} voice="calm-trend" />)
  await enable(); view.unmount()
  expect(media[0].pause).toHaveBeenCalledOnce()
  expect(media[0].src).toBe('')
})
