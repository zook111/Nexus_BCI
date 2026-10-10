import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectLiveStream, parseStreamSnapshot } from './liveStream'

const sockets: FakeSocket[] = []
class FakeSocket {
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  constructor() { sockets.push(this) }
}
const frame = { status: 'streaming', sample_count: 1, timestamps: [123], channels: [{ index: 1, label: 'C3', samples: [2] }] }

beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; vi.stubGlobal('WebSocket', FakeSocket) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('live stream recovery', () => {
  it('reconnects after close and resumes with fresh frames', () => {
    const snapshot = vi.fn(), unavailable = vi.fn()
    const connection = connectLiveStream('ws://localhost/stream', { snapshot, unavailable })
    sockets[0].onclose?.()
    expect(unavailable).toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    sockets[1].onmessage?.({ data: JSON.stringify(frame) })
    expect(snapshot).toHaveBeenCalledWith(frame)
    connection.close()
  })

  it('bounds retries, then permits a manual retry', () => {
    const unavailable = vi.fn()
    const connection = connectLiveStream('ws://localhost/stream', { snapshot: vi.fn(), unavailable })
    for (let index = 0; index < 7; index += 1) { sockets.at(-1)?.onerror?.(); vi.runOnlyPendingTimers() }
    expect(sockets).toHaveLength(7)
    expect(unavailable).toHaveBeenLastCalledWith(expect.stringContaining('Refresh'))
    connection.retry()
    expect(sockets).toHaveLength(8)
    connection.close()
  })

  it('cancels retry timers and ignores stale socket callbacks after cleanup', () => {
    const snapshot = vi.fn(), unavailable = vi.fn()
    const connection = connectLiveStream('ws://localhost/stream', { snapshot, unavailable })
    const staleMessage = sockets[0].onmessage
    sockets[0].onclose?.()
    connection.close()
    vi.runAllTimers()
    staleMessage?.({ data: JSON.stringify(frame) })
    expect(sockets).toHaveLength(1)
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('resets backoff only after a valid frame and suppresses malformed frames', () => {
    const snapshot = vi.fn(), unavailable = vi.fn()
    const connection = connectLiveStream('ws://localhost/stream', { snapshot, unavailable })
    sockets[0].onerror?.(); vi.advanceTimersByTime(500)
    sockets[1].onmessage?.({ data: 'broken' })
    expect(snapshot).not.toHaveBeenCalled()
    sockets[1].onmessage?.({ data: JSON.stringify(frame) })
    sockets[1].onclose?.(); vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(3)
    connection.close()
  })
})

it('parses optional board metadata without trusting an unchecked cast', () => {
  expect(parseStreamSnapshot(JSON.stringify({ ...frame, board: 'cyton_daisy', sampling_rate: 125, board_id: 2 }))).toMatchObject({ board: 'cyton_daisy', sampling_rate: 125 })
  expect(() => parseStreamSnapshot(JSON.stringify({ ...frame, channels: [{ index: 1, label: 'C3', samples: [null] }] }))).toThrow()
})
