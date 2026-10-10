import type { BoardKind, BoardState, BoardStatus, SerialPortInfo } from './api'

type BoardConnection = {
  board: BoardKind
  serial_port?: string
}

// Hardware connection is opt-in. Configure both the board type and serial locally to enable automatic setup.
function trustedSerialNumber() {
  return String(import.meta.env.VITE_OPENBCI_AUTOCONNECT_SERIAL ?? '').trim()
}

function automaticBoardKind(): 'cyton' | 'cyton_daisy' | null {
  const configured = String(import.meta.env.VITE_OPENBCI_AUTOCONNECT_BOARD ?? '').trim()
  return configured === 'cyton' || configured === 'cyton_daisy' ? configured : null
}

export type AutomaticDeviceSetup = {
  selectedBoard: BoardKind
  selectedPort: string
  connection: BoardConnection | null
}

export function resolveAutomaticDeviceSetup(
  board: BoardState,
  ports: SerialPortInfo[],
): AutomaticDeviceSetup {
  if (board.status !== 'idle') {
    return {
      selectedBoard: board.board ?? 'synthetic',
      selectedPort: board.serial_port ?? '',
      connection: null,
    }
  }

  const configuredBoard = automaticBoardKind()
  const recommendedPorts = ports.filter(
    (port) =>
      port.recommended &&
      Boolean(port.serial_number) &&
      port.serial_number === trustedSerialNumber(),
  )
  if (!configuredBoard || recommendedPorts.length !== 1) {
    return {
      selectedBoard: 'synthetic',
      selectedPort: '',
      connection: null,
    }
  }

  const [recommendedPort] = recommendedPorts
  return {
    selectedBoard: configuredBoard,
    selectedPort: recommendedPort.device,
    connection: {
      board: configuredBoard,
      serial_port: recommendedPort.device,
    },
  }
}

export function formatBoardActionError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  if (message.includes('BOARD_NOT_READY_ERROR')) {
    return 'Headset not ready. Check that the headset is powered and both blue lights are solid, then Reset and Connect again.'
  }
  return message
}

export function isDeviceSelectionLocked(status: BoardStatus) {
  return status !== 'idle'
}
