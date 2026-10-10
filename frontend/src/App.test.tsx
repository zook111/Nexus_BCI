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
