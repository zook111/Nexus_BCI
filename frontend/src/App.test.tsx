import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardState, RecordingState, SerialPortInfo } from './api'
import App from './App'

const apiMock = vi.hoisted(() => ({
  health: vi.fn(),
  ports: vi.fn(),
  board: vi.fn(),
  recording: vi.fn(),
  recordings: vi.fn(),
  connect: vi.fn(),
  start: vi.fn(),
  calmBaseline: vi.fn(),
  demoEvents: vi.fn(),
  dspSummary: vi.fn(),
  signalQuality: vi.fn(),
  calmFeatures: vi.fn(),
  recordingPreview: vi.fn(),
  recordingAnalysis: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    api: apiMock,
    API_BASE_URL: 'http://localhost:8000',
    STREAM_WS_URL: 'ws://localhost:8000/ws/stream',
  }
})

const sockets: FakeWebSocket[] = []

class FakeWebSocket {
  constructor() { sockets.push(this) }
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null

  close() {}
}

const trustedPort: SerialPortInfo = {
  device: '/dev/cu.usbserial-EXAMPLE001',
  name: 'cu.usbserial-EXAMPLE001',
  description: 'FT231X USB UART',
  manufacturer: 'FTDI',
  serial_number: 'EXAMPLE001',
  transport: 'usb',
  recommended: true,
  rank: 85,
  message: 'Recommended OpenBCI candidate',
}

const idleBoard: BoardState = {
  status: 'idle',
  eeg_channels: [],
  eeg_names: [],
}

const preparedBoard: BoardState = {
  status: 'prepared',
  board: 'cyton',
  serial_port: trustedPort.device,
  sampling_rate: 250,
  eeg_channels: [1, 2, 3, 4, 5, 6, 7, 8],
  eeg_names: ['Fp1', 'Fp2', 'C3', 'C4', 'P7', 'P8', 'O1', 'O2'],
}

const emptyRecording: RecordingState = {
  active: false,
  sample_count: 0,
  eeg_names: [],
  setup_quality_snapshots: [],
  calibration_markers: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', 'EXAMPLE001')
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_BOARD', 'cyton')
  sockets.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
  apiMock.health.mockResolvedValue({ status: 'ok', service: 'mindmeld-api', version: '0.1.0' })
  apiMock.ports.mockResolvedValue([trustedPort])
  apiMock.board.mockResolvedValue(idleBoard)
  apiMock.recording.mockResolvedValue(emptyRecording)
  apiMock.recordings.mockResolvedValue([])
  apiMock.calmBaseline.mockResolvedValue({
    status: 'inactive',
    elapsed_seconds: 0,
    target_duration_seconds: 30,
    accepted_windows: 0,
    required_windows: 3,
    line_frequency_hz: 50,
    window_size: 1000,
    posterior_labels: ['P7', 'P8', 'O1', 'O2'],
  })
  apiMock.demoEvents.mockResolvedValue([])
  apiMock.dspSummary.mockResolvedValue({ status: 'streaming', sample_count: 0, window_size: 500, bandpass_low_hz: 1, bandpass_high_hz: 45, channels: [] })
  apiMock.signalQuality.mockResolvedValue({ status: 'streaming', sample_count: 0, sampling_rate: 250, window_size: 500, channels: [], good_channels: 0, questionable_channels: 0, bad_channels: 0 })
  apiMock.calmFeatures.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('automatic Cyton connection state', () => {
  it('keeps device controls disabled until the startup connection settles', async () => {
    let finishConnection: (board: BoardState) => void = () => undefined
    apiMock.connect.mockReturnValue(
      new Promise<BoardState>((resolve) => {
        finishConnection = resolve
      }),
    )

    render(<App />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Board' })).toHaveValue('cyton'))
    expect(screen.getByRole('combobox', { name: 'Board' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Serial port' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()

    finishConnection(preparedBoard)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
  })

  it('loads the backend error state so Reset is available after auto-connect fails', async () => {
    const errorBoard: BoardState = {
      ...preparedBoard,
      status: 'error',
      message: 'BOARD_NOT_READY_ERROR:7 unable to prepare streaming session',
    }
    apiMock.board.mockResolvedValueOnce(idleBoard).mockResolvedValueOnce(errorBoard)
    apiMock.connect.mockRejectedValue(
      new Error('{"detail":"BOARD_NOT_READY_ERROR:7 unable to prepare streaming session"}'),
    )

    render(<App />)

    expect(
      await screen.findByText(
        'Headset not ready. Check that the headset is powered and both blue lights are solid, then Reset and Connect again.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled())
    expect(apiMock.board).toHaveBeenCalledTimes(2)
  })
})


it.each(['prepared', 'streaming'] as const)('pauses %s device controls on a failed stream frame', async (status) => {
  apiMock.board.mockResolvedValue({ ...preparedBoard, status })
  render(<App />)
  const controls = within(screen.getByRole('button', { name: 'Start' }).parentElement!)
  await waitFor(() => expect(controls.getByRole('button', { name: 'Reset' })).toBeEnabled())
  const message = 'Signal paused: native board session lost. Reset and connect again.'
  await act(async () => { sockets.at(-1)?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ status: 'error', sample_count: 0, timestamps: [], channels: [], message }) })) })
  await screen.findByText(message)
  expect(controls.getByRole('button', { name: /^Stop$/ })).toBeDisabled()
  expect(controls.getByRole('button', { name: 'Start' })).toBeDisabled()
  expect(controls.getByRole('button', { name: 'Reset' })).toBeEnabled()
})


it('refreshes backend state after a failed Start so a lost prepared session offers Reset', async () => {
  apiMock.board.mockResolvedValueOnce(preparedBoard).mockResolvedValue({ ...preparedBoard, status: 'error' })
  apiMock.start.mockRejectedValue(new Error('Native start failed. Reset and connect again.'))
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
  const controls = within(screen.getByRole('button', { name: 'Start' }).parentElement!)
  fireEvent.click(controls.getByRole('button', { name: 'Start' }))
  await screen.findByText('Native start failed. Reset and connect again.')
  await waitFor(() => expect(controls.getByRole('button', { name: 'Start' })).toBeDisabled())
  expect(controls.getByRole('button', { name: 'Reset' })).toBeEnabled()
})

it('shows an incomplete recording storage failure beside the recording controls', async () => {
  const message = 'Recording stopped incomplete: storage failure: disk full'
  apiMock.recording.mockResolvedValue({ ...emptyRecording, message })
  render(<App />)
  expect(await screen.findByText(message)).toHaveAttribute('role', 'alert')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('opens student Help without a headset and returns to Console', async () => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  const help = screen.getByRole('region', { name: 'Help and student guides' })
  for (const guide of [
    { name: 'Open setup guide PDF (opens in a new tab)', file: 'intel-ventura-setup.pdf' },
    { name: 'Open experiment guide PDF (opens in a new tab)', file: 'eyes-open-closed-experiment-guide.pdf' },
    { name: 'Open research guide PDF (opens in a new tab)', file: 'student-starter-guide.pdf' },
  ]) {
    const link = within(help).getByRole('link', { name: guide.name })
    expect(link.getAttribute('href')).toContain(guide.file)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
  expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('aria-pressed', 'true')
  expect(apiMock.connect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Console' }))
  expect(screen.queryByRole('region', { name: 'Help and student guides' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Console' })).toHaveAttribute('aria-pressed', 'true')
})

it('follows another window through connect, start, stop and reset without reloading', async () => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled())
  const controls = within(screen.getByRole('button', { name: 'Start' }).parentElement!)
  async function broadcast(board: BoardState) {
    await act(async () => {
      sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ ...board, sample_count: 0, timestamps: [], channels: [] }),
      }))
    })
  }
  await broadcast(preparedBoard)
  expect(screen.getByRole('combobox', { name: 'Board' })).toHaveValue('cyton')
  expect(screen.getByRole('combobox', { name: 'Serial port' })).toHaveValue(trustedPort.device)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  expect(controls.getByRole('button', { name: 'Start' })).toBeEnabled()
  await broadcast({ ...preparedBoard, status: 'streaming' })
  expect(controls.getByRole('button', { name: 'Start' })).toBeDisabled()
  expect(controls.getByRole('button', { name: 'Stop' })).toBeEnabled()
  expect(apiMock.signalQuality).toHaveBeenCalled()
  expect(apiMock.dspSummary).toHaveBeenCalled()
  await broadcast(preparedBoard)
  expect(controls.getByRole('button', { name: 'Start' })).toBeEnabled()
  expect(controls.getByRole('button', { name: 'Stop' })).toBeDisabled()
  const failure = 'Signal paused: native session lost. Reset and connect again.'
  await broadcast({ ...preparedBoard, status: 'error', serial_port: null, message: failure })
  expect(screen.getByText(failure)).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Serial port' })).toHaveValue(trustedPort.device)
  expect(controls.getByRole('button', { name: 'Start' })).toBeDisabled()
  await broadcast(preparedBoard)
  expect(screen.queryByText(failure)).not.toBeInTheDocument()
  expect(controls.getByRole('button', { name: 'Start' })).toBeEnabled()
  await broadcast(idleBoard)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(controls.getByRole('button', { name: 'Reset' })).toBeDisabled()
  // Passive observers must never claim or restart the serial session themselves.
  expect(apiMock.connect).not.toHaveBeenCalled()
  expect(apiMock.start).not.toHaveBeenCalled()
})

it('keeps a manually selected board while receiving idle frames', async () => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled())
  fireEvent.change(screen.getByRole('combobox', { name: 'Board' }), { target: { value: 'cyton_daisy' } })
  await act(async () => {
    sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ ...idleBoard, sample_count: 0, timestamps: [], channels: [] }),
    }))
  })
  expect(screen.getByRole('combobox', { name: 'Board' })).toHaveValue('cyton_daisy')
})

it('leaves saved replay for a shared stream start but permits replay during an existing stream', async () => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  apiMock.board.mockResolvedValue(preparedBoard)
  const saved = { ...emptyRecording, session_id: 'saved-replay', label: 'Saved practice', sampling_rate: 250, sample_count: 2 }
  apiMock.recordings.mockResolvedValue([saved])
  apiMock.recordingPreview.mockResolvedValue({ recording: saved, offset: 0, total_rows: 2, row_count: 2, headers: ['timestamp', 'Fp1'], rows: [[1, 2], [2, 3]], timestamps: [1, 2], channels: [{ index: 1, label: 'Fp1', samples: [2, 3] }] })
  apiMock.recordingAnalysis.mockResolvedValue({ recording: saved, offset: 0, total_rows: 2, sample_count: 2, sampling_rate: 250, bandpass_low_hz: 1, bandpass_high_hz: 45, channels: [] })
  render(<App />)
  await screen.findByRole('button', { name: 'Preview' })
  async function broadcast(status: 'prepared' | 'streaming') {
    await act(async () => {
      sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ ...preparedBoard, status, sample_count: 0, timestamps: [], channels: [] }),
      }))
    })
  }
  await broadcast('prepared')
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByText('Replay window loaded')
  await broadcast('streaming')
  expect(screen.queryByText('Replay window loaded')).not.toBeInTheDocument()
  expect(apiMock.signalQuality).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByText('Replay window loaded')
  await broadcast('streaming')
  expect(screen.getByText('Replay window loaded')).toBeInTheDocument()
})

it('shows an active serial port discovered by another window after this tab loaded', async () => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  apiMock.ports.mockResolvedValue([])
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled())
  await act(async () => {
    sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ ...preparedBoard, sample_count: 0, timestamps: [], channels: [] }),
    }))
  })
  expect(screen.getByRole('combobox', { name: 'Serial port' })).toHaveValue(trustedPort.device)
  expect(screen.getByText('Active backend serial port')).toBeInTheDocument()
  expect(apiMock.connect).not.toHaveBeenCalled()
  const otherPort = '/dev/cu.usbserial-EXAMPLE002'
  await act(async () => {
    sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ ...preparedBoard, serial_port: otherPort, sample_count: 0, timestamps: [], channels: [] }),
    }))
  })
  expect(screen.queryByRole('option', { name: new RegExp(trustedPort.device) })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Serial port' })).toHaveValue(otherPort)
  await act(async () => {
    sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ ...idleBoard, sample_count: 0, timestamps: [], channels: [] }),
    }))
  })
  expect(screen.queryByRole('option', { name: new RegExp(otherPort) })).not.toBeInTheDocument()
  expect(screen.queryByText('Active backend serial port')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
})

it.each(['resolve', 'reject'])('ignores an old replay request that later %ss after a shared stream start', async outcome => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  apiMock.board.mockResolvedValue(preparedBoard)
  const saved = { ...emptyRecording, session_id: 'pending-replay', label: 'Saved practice', sampling_rate: 250, sample_count: 2 }
  const preview = { recording: saved, offset: 0, total_rows: 2, row_count: 2, headers: ['timestamp', 'Fp1'], rows: [[1, 2], [2, 3]] }
  let resolve: (value: typeof preview) => void = () => {}
  let reject: (error: Error) => void = () => {}
  apiMock.recordings.mockResolvedValue([saved])
  apiMock.recordingPreview.mockReturnValue(new Promise<typeof preview>((yes, no) => { resolve = yes; reject = no }))
  apiMock.recordingAnalysis.mockResolvedValue({ recording: saved, offset: 0, total_rows: 2, sample_count: 2, sampling_rate: 250, bandpass_low_hz: 1, bandpass_high_hz: 45, channels: [] })
  render(<App />)
  await screen.findByRole('button', { name: 'Preview' })
  async function broadcast(status: 'prepared' | 'streaming') {
    await act(async () => {
      sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ ...preparedBoard, status, sample_count: 0, timestamps: [], channels: [] }),
      }))
    })
  }
  await broadcast('prepared')
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(() => expect(apiMock.recordingPreview).toHaveBeenCalled())
  await broadcast('streaming')
  await act(async () => {
    if (outcome === 'resolve') resolve(preview)
    else reject(new Error('Obsolete replay failure'))
  })
  expect(screen.queryByText('Replay window loaded')).not.toBeInTheDocument()
  expect(screen.queryByText('Obsolete replay failure')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
  expect(apiMock.signalQuality).toHaveBeenCalled()
})

it('clears observer feedback history on a shared reset', async () => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
  apiMock.board.mockResolvedValue({ ...preparedBoard, status: 'streaming' })
  apiMock.calmFeatures.mockResolvedValue({ status: 'streaming', signal_state: 'usable', confidence: .9,
    calm_score: .5, source_timestamp: Date.now() / 1000, features: {}, flags: [] })
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Feedback Lab' }))
  const trend = () => screen.getByRole('img', { name: 'Feedback trend history' }).querySelector('.calm-trend__line')!
  await waitFor(() => expect(trend().getAttribute('d')).not.toBe(''), { timeout: 2500 })
  await act(async () => {
    sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ ...preparedBoard, status: 'streaming', sample_count: 0, timestamps: [], channels: [] }),
    }))
    sockets.at(-1)?.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ ...idleBoard, sample_count: 0, timestamps: [], channels: [] }),
    }))
  })
  expect(trend().getAttribute('d')).toBe('')
})
