import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardState, SerialPortInfo } from './api'
import {
  formatBoardActionError,
  isDeviceSelectionLocked,
  resolveAutomaticDeviceSetup,
} from './deviceSetup'

const idleBoard: BoardState = {
  status: 'idle',
  eeg_channels: [],
  eeg_names: [],
}

const cytonPort: SerialPortInfo = {
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

beforeEach(() => {
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', 'EXAMPLE001')
  vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_BOARD', 'cyton')
})
afterEach(() => vi.unstubAllEnvs())

describe('automatic device setup', () => {
  it('requires an explicit board definition alongside the serial opt-in', () => {
    vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_BOARD', '')
    expect(resolveAutomaticDeviceSetup(idleBoard, [cytonPort]).connection).toBeNull()
  })

  it('uses the Daisy definition for a configured Cyton Daisy dongle', () => {
    vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_BOARD', 'cyton_daisy')
    expect(resolveAutomaticDeviceSetup(idleBoard, [cytonPort])).toEqual({
      selectedBoard: 'cyton_daisy',
      selectedPort: cytonPort.device,
      connection: { board: 'cyton_daisy', serial_port: cytonPort.device },
    })
  })

  it('does not connect using an unsupported board definition', () => {
    vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_BOARD', 'unknown')
    expect(resolveAutomaticDeviceSetup(idleBoard, [cytonPort]).connection).toBeNull()
  })

  it('requires explicit local opt-in before opening any hardware port', () => {
    vi.stubEnv('VITE_OPENBCI_AUTOCONNECT_SERIAL', '')
    expect(resolveAutomaticDeviceSetup(idleBoard, [cytonPort]).connection).toBeNull()
  })

  it('plans one Cyton connection for the only recommended USB dongle', () => {
    expect(resolveAutomaticDeviceSetup(idleBoard, [cytonPort])).toEqual({
      selectedBoard: 'cyton',
      selectedPort: '/dev/cu.usbserial-EXAMPLE001',
      connection: {
        board: 'cyton',
        serial_port: '/dev/cu.usbserial-EXAMPLE001',
      },
    })
  })

  it('does not auto-connect when more than one dongle is recommended', () => {
    const secondPort = {
      ...cytonPort,
      device: '/dev/cu.usbserial-SECOND',
    }

    expect(resolveAutomaticDeviceSetup(idleBoard, [cytonPort, secondPort])).toEqual({
      selectedBoard: 'synthetic',
      selectedPort: '',
      connection: null,
    })
  })

  it('does not auto-connect an unrecognized generic FTDI adapter', () => {
    const genericFtdiPort = {
      ...cytonPort,
      device: '/dev/cu.usbserial-GENERIC',
      serial_number: 'GENERIC',
    }

    expect(resolveAutomaticDeviceSetup(idleBoard, [genericFtdiPort])).toEqual({
      selectedBoard: 'synthetic',
      selectedPort: '',
      connection: null,
    })
  })

  it('keeps the controls aligned with an already prepared board session', () => {
    const preparedBoard: BoardState = {
      status: 'prepared',
      board: 'cyton',
      serial_port: '/dev/cu.usbserial-EXAMPLE001',
      sampling_rate: 250,
      eeg_channels: [1, 2, 3, 4, 5, 6, 7, 8],
      eeg_names: ['Fp1', 'Fp2', 'C3', 'C4', 'P7', 'P8', 'O1', 'O2'],
    }

    expect(resolveAutomaticDeviceSetup(preparedBoard, [cytonPort])).toEqual({
      selectedBoard: 'cyton',
      selectedPort: '/dev/cu.usbserial-EXAMPLE001',
      connection: null,
    })
  })

  it('does not retry automatically while the backend is in an error state', () => {
    const errorBoard: BoardState = {
      status: 'error',
      message: 'BOARD_NOT_READY_ERROR:7 unable to prepare streaming session',
      eeg_channels: [],
      eeg_names: [],
    }

    expect(resolveAutomaticDeviceSetup(errorBoard, [cytonPort])).toEqual({
      selectedBoard: 'synthetic',
      selectedPort: '',
      connection: null,
    })
  })

  it('locks device selection until an existing session is reset', () => {
    expect(isDeviceSelectionLocked('idle')).toBe(false)
    expect(isDeviceSelectionLocked('prepared')).toBe(true)
    expect(isDeviceSelectionLocked('streaming')).toBe(true)
  })

  it('turns the BrainFlow board-not-ready code into a useful recovery instruction', () => {
    expect(
      formatBoardActionError(
        new Error('{"detail":"BOARD_NOT_READY_ERROR:7 unable to prepare streaming session"}'),
      ),
    ).toBe(
      'Headset not ready. Check that the headset is powered and both blue lights are solid, then Reset and Connect again.',
    )
  })
})
