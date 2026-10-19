import type { BoardState, StreamSnapshot } from './api'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

export function parseStreamSnapshot(data: string): StreamSnapshot {
  const raw: unknown = JSON.parse(data)
  if (!record(raw)) {
    throw new Error('Invalid stream status')
  }
  const status = raw.status
  if (status !== 'idle' && status !== 'prepared' && status !== 'streaming' && status !== 'error') {
    throw new Error('Invalid stream status')
  }
  if (typeof raw.sample_count !== 'number' || !Number.isInteger(raw.sample_count) || raw.sample_count < 0
    || !numbers(raw.timestamps) || !Array.isArray(raw.channels)) throw new Error('Invalid stream data')
  const channels = raw.channels.map((channel: unknown) => {
    if (!record(channel) || typeof channel.index !== 'number' || !Number.isInteger(channel.index)
      || channel.index < 0 || typeof channel.label !== 'string' || !numbers(channel.samples)) {
      throw new Error('Invalid channel data')
    }
    return { index: channel.index, label: channel.label, samples: channel.samples }
  })
  const result: StreamSnapshot = { status, sample_count: raw.sample_count, timestamps: raw.timestamps, channels }
  if (raw.connection_id !== undefined) {
    if (raw.connection_id !== null && (typeof raw.connection_id !== 'string' || !raw.connection_id)) {
      throw new Error('Invalid connection identity')
    }
    result.connection_id = raw.connection_id
  }
  if (raw.serial_port !== undefined) {
    if (raw.serial_port !== null && typeof raw.serial_port !== 'string') throw new Error('Invalid serial port')
    result.serial_port = raw.serial_port
  }
  if (raw.eeg_channels !== undefined || raw.eeg_names !== undefined) {
    if (!numbers(raw.eeg_channels) || !raw.eeg_channels.every(index => Number.isInteger(index) && index >= 0)
      || !Array.isArray(raw.eeg_names) || !raw.eeg_names.every(name => typeof name === 'string')
      || raw.eeg_channels.length !== raw.eeg_names.length) throw new Error('Invalid EEG metadata')
    result.eeg_channels = raw.eeg_channels
    result.eeg_names = raw.eeg_names
  }
  if (raw.board !== undefined && raw.board !== null) {
    if (raw.board !== 'synthetic' && raw.board !== 'cyton' && raw.board !== 'cyton_daisy') throw new Error('Invalid board')
    result.board = raw.board
  }
  for (const key of ['sampling_rate', 'board_id'] as const) {
    const value = raw[key]
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid board metadata')
      result[key] = value
    }
  }
  if (raw.message !== undefined && raw.message !== null) {
    if (typeof raw.message !== 'string') throw new Error('Invalid stream message')
    result.message = raw.message
  }
  return result
}

export function sharedBoardState(current: BoardState, snapshot: StreamSnapshot): BoardState {
  if (!snapshot.eeg_channels || !snapshot.eeg_names) return current
  const next: BoardState = {
    status: snapshot.status,
    connection_id: snapshot.connection_id ?? null,
    board: snapshot.board ?? null,
    board_id: snapshot.board_id ?? null,
    serial_port: snapshot.serial_port ?? null,
    sampling_rate: snapshot.sampling_rate ?? null,
    eeg_channels: snapshot.eeg_channels,
    eeg_names: snapshot.eeg_names,
    message: snapshot.message ?? null,
  }
  // Preserve identity for unchanged metadata so sample frames do not restart
  // consumers that depend on the board object or its channel arrays.
  const same = current.status === next.status
    && (current.connection_id ?? null) === next.connection_id
    && (current.board ?? null) === next.board
    && (current.board_id ?? null) === next.board_id
    && (current.serial_port ?? null) === next.serial_port
    && (current.sampling_rate ?? null) === next.sampling_rate
    && (current.message ?? null) === next.message
    && current.eeg_channels.length === next.eeg_channels.length
    && current.eeg_channels.every((channel, index) => channel === next.eeg_channels[index])
    && current.eeg_names.length === next.eeg_names.length
    && current.eeg_names.every((name, index) => name === next.eeg_names[index])
  return same ? current : next
}

export function connectLiveStream(url: string, handlers: {
  snapshot: (snapshot: StreamSnapshot) => void
  unavailable: (message: string) => void
}) {
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof window.setTimeout> | null = null
  let stopped = false
  let retries = 0
  const maxRetries = 6

  function detach() {
    if (socket) {
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
      socket = null
    }
  }

  function schedule() {
    if (stopped || timer !== null) return
    if (retries >= maxRetries) {
      handlers.unavailable('Live stream paused. Reconnect attempts exhausted; click Refresh to retry.')
      return
    }
    const delay = Math.min(500 * 2 ** retries, 8000)
    retries += 1
    handlers.unavailable(`Live stream paused. Reconnecting (${retries}/${maxRetries})...`)
    timer = window.setTimeout(() => { timer = null; connect() }, delay)
  }

  function connect() {
    if (stopped) return
    let current: WebSocket
    try {
      current = new WebSocket(url)
    } catch {
      schedule()
      return
    }
    socket = current
    current.onmessage = event => {
      if (stopped || socket !== current) return
      try {
        if (typeof event.data !== 'string') throw new Error('Invalid stream payload')
        const snapshot = parseStreamSnapshot(event.data)
        retries = 0 // A valid frame proves recovery; a brief open/close does not.
        handlers.snapshot(snapshot)
      } catch {
        handlers.unavailable('Live stream paused. Invalid signal frame received.')
      }
    }
    current.onerror = () => {
      if (stopped || socket !== current) return
      detach()
      schedule()
    }
    current.onclose = () => {
      if (stopped || socket !== current) return
      detach()
      schedule()
    }
  }

  connect()
  return {
    retry() {
      if (stopped) return
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      detach()
      retries = 0
      connect()
    },
    close() {
      stopped = true
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      detach()
    },
  }
}
