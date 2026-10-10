import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardState, CalmFeatureResponse, DemoEvent, DemoRun } from '../api'
import { DoctorDemo, type DoctorDemoClient } from './DoctorDemo'

const streamingBoard: BoardState = {
  status: 'streaming',
  board: 'cyton',
  sampling_rate: 250,
  eeg_channels: [0, 1, 2, 3, 4, 5, 6, 7],
  eeg_names: ['Fp1', 'Fp2', 'C3', 'C4', 'P7', 'P8', 'O1', 'O2'],
}

function calm(alphaPost: number): CalmFeatureResponse {
  return {
    status: 'streaming',
    board: 'cyton',
    sample_count: 1000,
    source_timestamp: alphaPost,
    sampling_rate: 250,
    window_size: 1000,
    line_frequency_hz: 60,
    posterior_labels: ['P7', 'P8', 'O1', 'O2'],
    used_labels: ['P7', 'P8', 'O1', 'O2'],
    signal_state: 'usable',
    confidence: 0.92,
    calm_score: null,
    trend: null,
    flags: [],
    features: { alpha_post: alphaPost },
    baseline: {
      status: 'inactive',
      elapsed_seconds: 0,
      target_duration_seconds: 30,
      accepted_windows: 0,
      required_windows: 3,
      line_frequency_hz: 60,
      window_size: 1000,
      posterior_labels: ['P7', 'P8', 'O1', 'O2'],
    },
  }
}

function makeClient(seedEvents: DemoEvent[] = [], seedRuns: DemoRun[] = []): DoctorDemoClient {
  const events = [...seedEvents]
  const runs = [...seedRuns]
  return {
    demoEvents: async () => [...events],
    createDemoEvent: async ({ name }) => {
      const event = { id: `event-${events.length + 1}`, name, created_at: '2026-08-12T09:00:00Z' }
      events.unshift(event)
      return event
    },
    demoRuns: async () => [...runs],
    createDemoRun: async (eventId, payload) => {
      const run: DemoRun = {
        id: `run-${runs.length + 1}`,
        event_id: eventId,
        ...payload,
        recording_session_id: payload.recording_session_id ?? null,
        completed_at: '2026-08-12T09:05:00Z',
        is_best: true,
      }
      runs.unshift(run)
      return run
    },
  }
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const audioInstances: FakeAudio[] = []
let audioPlayFailure: unknown = null

class FakeAudio {
  src: string
  loop = false
  volume = 1
  playbackRate = 1
  currentTime = 0
  paused = true
  preload = ''
  play = vi.fn(async () => {
    if (audioPlayFailure) {
      const failure = audioPlayFailure
      audioPlayFailure = null
      throw failure
    }
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })

  constructor(src = '') {
    this.src = src
    audioInstances.push(this)
  }
}

describe('DoctorDemo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T09:00:00Z'))
    audioInstances.length = 0
    audioPlayFailure = null
    vi.stubGlobal('Audio', FakeAudio)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('plays distinct eye-state cues and starts the looping Reactor soundtrack', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const client = makeClient([event])
    const durations = { openSeconds: 1, closedSeconds: 1, challengeSeconds: 2 }
    const { rerender } = render(
      <DoctorDemo board={streamingBoard} calm={calm(1.2)} latestStreamTimestamp={1}
        client={client} durations={durations} />,
    )
    await flushPromises()

    expect(screen.getByRole('button', { name: 'Mute Doctor Demo audio' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Maya Shah' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))

    expect(audioInstances.at(-1)?.src).toContain('eyes-open')
    expect(audioInstances.at(-1)?.play).toHaveBeenCalled()
    const firstOpenCue = audioInstances.at(-1)

    rerender(
      <DoctorDemo active={false} board={streamingBoard} calm={calm(1.2)}
        latestStreamTimestamp={1} client={client} durations={durations} />,
    )
    expect(firstOpenCue?.pause).toHaveBeenCalled()

    rerender(
      <DoctorDemo active board={streamingBoard} calm={calm(1.2)} latestStreamTimestamp={1}
        client={client} durations={durations} />,
    )
    expect(audioInstances.at(-1)).toBe(firstOpenCue)
    expect(audioInstances.at(-1)?.src).toContain('eyes-open')
    expect(firstOpenCue?.play).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTime(1_000))
    expect(screen.getByRole('heading', { name: 'Eyes closed' })).toBeInTheDocument()
    expect(audioInstances.at(-1)?.src).toContain('eyes-closed')

    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(2.8)} latestStreamTimestamp={2}
        client={client} durations={durations} />,
    )
    await act(async () => vi.advanceTimersByTime(1_000))
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))

    expect(audioInstances.at(-1)?.src).toContain('reactor-loop')
    expect(audioInstances.at(-1)?.loop).toBe(true)
    expect(audioInstances.at(-1)?.play).toHaveBeenCalled()
    expect(audioInstances.at(-1)?.volume).toBeGreaterThan(0)

    const noisyCalm = { ...calm(3.2), confidence: 0.2, signal_state: 'noisy' as const }
    rerender(
      <DoctorDemo board={streamingBoard} calm={noisyCalm} latestStreamTimestamp={3}
        client={client} durations={durations} />,
    )
    expect(audioInstances.at(-1)?.volume).toBe(0)
    const firstReactorTrack = audioInstances.at(-1)

    rerender(
      <DoctorDemo active={false} board={streamingBoard} calm={noisyCalm}
        latestStreamTimestamp={3} client={client} durations={durations} />,
    )
    expect(firstReactorTrack?.pause).toHaveBeenCalled()

    rerender(
      <DoctorDemo active board={streamingBoard} calm={noisyCalm} latestStreamTimestamp={3}
        client={client} durations={durations} />,
    )
    expect(audioInstances.at(-1)).not.toBe(firstReactorTrack)
    expect(audioInstances.at(-1)?.volume).toBe(0)
  })

  it('creates and selects a local room when no saved room exists', async () => {
    render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        client={makeClient()}
      />,
    )
    await flushPromises()

    fireEvent.change(screen.getByLabelText('New room name'), {
      target: { value: 'Science evening' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }))
    await flushPromises()

    expect(screen.getByRole('heading', { name: 'Science evening' })).toBeInTheDocument()
    expect(screen.getByLabelText('Participant display name')).toBeInTheDocument()
  })

  it('lets a named participant begin while the live signal settles', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const client = makeClient([event])
    const { rerender } = render(
      <DoctorDemo
        board={{ ...streamingBoard, status: 'prepared' }}
        calm={calm(1.2)}
        latestStreamTimestamp={null}
        client={client}
      />,
    )
    await flushPromises()

    const beginButton = screen.getByRole('button', { name: 'Begin proof' })
    expect(beginButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Maya Shah' },
    })

    const readiness = screen.getByRole('status', { name: 'Proof readiness' })
    expect(within(readiness).getByText('Participant ready')).toBeInTheDocument()
    expect(within(readiness).getByText('Signal needs attention')).toBeInTheDocument()
    expect(within(readiness).getByText('Confidence 92%')).toBeInTheDocument()
    expect(within(readiness).getByText('Signal paused — start the live stream')).toBeInTheDocument()
    expect(within(readiness).getByText('You can begin now; timing will wait for clean signal.')).toBeInTheDocument()
    expect(beginButton).toBeEnabled()
    audioPlayFailure = { name: 'AbortError' }
    fireEvent.click(beginButton)
    await flushPromises()
    expect(screen.getByRole('heading', { name: 'Eyes open' })).toBeInTheDocument()
    expect(screen.queryByText('Audio was blocked. Press Sound off, then Sound on to enable it.')).not.toBeInTheDocument()
    expect(audioInstances).toHaveLength(1)
    expect(audioInstances.at(-1)?.src).toContain('eyes-open')
    expect(audioInstances.at(-1)?.volume).toBe(0)
    expect(audioInstances.at(-1)?.play).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mute Doctor Demo audio' }))
    audioPlayFailure = { name: 'NotAllowedError' }
    fireEvent.click(screen.getByRole('button', { name: 'Enable Doctor Demo audio' }))
    await flushPromises()
    expect(screen.getByText('Audio was blocked. Press Sound off, then Sound on to enable it.')).toBeInTheDocument()
    expect(audioInstances).toHaveLength(2)
    expect(audioInstances.at(-1)?.volume).toBe(0)
    expect(audioInstances.at(-1)?.play).toHaveBeenCalled()
    expect(screen.getAllByText('Signal paused — start the live stream')).toHaveLength(2)
    expect(screen.getByText('Timing starts automatically when the signal is ready.')).toBeInTheDocument()
    const primedCue = audioInstances.at(-1)

    rerender(
      <DoctorDemo active={false} board={{ ...streamingBoard, status: 'prepared' }}
        calm={calm(1.2)} latestStreamTimestamp={null} client={client} />,
    )
    rerender(
      <DoctorDemo active board={{ ...streamingBoard, status: 'prepared' }}
        calm={calm(1.2)} latestStreamTimestamp={null} client={client} />,
    )
    rerender(
      <DoctorDemo active board={streamingBoard} calm={calm(2)}
        latestStreamTimestamp={2} client={client} />,
    )
    await flushPromises()
    expect(audioInstances).toHaveLength(2)
    expect(audioInstances.at(-1)).toBe(primedCue)
    expect(primedCue?.volume).toBe(0.95)
    expect(primedCue?.play).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Audio was blocked. Press Sound off, then Sound on to enable it.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to setup' }))
    expect(screen.getByLabelText('Participant display name')).toHaveValue('Dr Maya Shah')
    expect(screen.getByRole('button', { name: 'Begin proof' })).toBeEnabled()
  })

  it('reopens a saved room constellation without requiring another run', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const savedRun: DemoRun = {
      id: 'run-1',
      event_id: event.id,
      participant_name: 'Dr Maya Shah',
      participant_initials: 'MS',
      open_alpha: 1.2,
      closed_alpha: 2.6,
      alpha_lift_percent: 116.67,
      threshold_alpha: 2.11,
      clean_hold_seconds: 12.4,
      confidence: 0.98,
      score: 842,
      scoring_version: 'doctor-demo-v1',
      recording_session_id: null,
      completed_at: '2026-08-12T09:05:00Z',
      is_best: true,
    }
    render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        client={makeClient([event], [savedRun])}
      />,
    )
    await flushPromises()

    fireEvent.click(screen.getByRole('button', { name: 'View constellation' }))

    expect(screen.getByRole('heading', { name: 'Room Constellation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dr Maya Shah star/i })).toBeInTheDocument()
    expect(screen.getByText('2026-08-12 09:05 UTC')).toBeInTheDocument()
  })

  it('does not carry stars into a room whose results fail to load', async () => {
    const firstEvent = { id: 'event-1', name: 'First room', created_at: '2026-08-12T08:00:00Z' }
    const secondEvent = { id: 'event-2', name: 'Second room', created_at: '2026-08-12T07:00:00Z' }
    const savedRun: DemoRun = {
      id: 'run-1',
      event_id: firstEvent.id,
      participant_name: 'Dr Maya Shah',
      participant_initials: 'MS',
      open_alpha: 1.2,
      closed_alpha: 2.6,
      alpha_lift_percent: 116.67,
      threshold_alpha: 2.11,
      clean_hold_seconds: 12.4,
      confidence: 0.98,
      score: 842,
      scoring_version: 'doctor-demo-v1',
      recording_session_id: null,
      completed_at: '2026-08-12T09:05:00Z',
      is_best: true,
    }
    const client: DoctorDemoClient = {
      ...makeClient([firstEvent, secondEvent]),
      demoRuns: async (eventId) => {
        if (eventId === secondEvent.id) throw new Error('load failed')
        return [savedRun]
      },
    }
    render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        client={client}
      />,
    )
    await flushPromises()

    expect(screen.getByText('1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Room'), { target: { value: secondEvent.id } })
    await flushPromises()

    expect(screen.getByRole('heading', { name: 'Second room' })).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View constellation' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved constellation results could not be loaded',
    )
  })

  it('preserves and pauses an active proof while its workspace is hidden', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const client = makeClient([event])
    const liveCalm = calm(1.2)
    const { rerender } = render(
      <DoctorDemo
        active
        board={streamingBoard}
        calm={liveCalm}
        latestStreamTimestamp={1}
        client={client}
        durations={{ openSeconds: 2, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await flushPromises()
    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Workspace Switch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByText('1.5s')).toBeInTheDocument()

    rerender(
      <DoctorDemo
        active={false}
        board={streamingBoard}
        calm={liveCalm}
        latestStreamTimestamp={2}
        client={client}
        durations={{ openSeconds: 2, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })

    expect(screen.getByRole('heading', { name: 'Eyes open' })).toBeInTheDocument()
    expect(screen.getByText('1.5s')).toBeInTheDocument()
  })

  it('keeps the stage clock continuous across fresh feature responses', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const client = makeClient([event])
    const durations = { openSeconds: 3, closedSeconds: 1, challengeSeconds: 1 }
    const { rerender } = render(
      <DoctorDemo board={streamingBoard} calm={calm(1.2)} latestStreamTimestamp={1}
        client={client} durations={durations} />,
    )
    await flushPromises()
    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Feature Poll' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))

    for (let poll = 1; poll <= 10; poll += 1) {
      await act(async () => vi.advanceTimersByTime(300))
      rerender(
        <DoctorDemo board={streamingBoard} calm={calm(1.2 + poll / 100)}
          latestStreamTimestamp={poll + 1} client={client}
          durations={durations} />,
      )
    }

    expect(screen.getByRole('heading', { name: 'Eyes closed' })).toBeInTheDocument()
  })

  it('completes proof and reactor, saves a selectable star, and resets for the next participant', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const client = makeClient([event])
    const createRun = vi.spyOn(client, 'createDemoRun')
    const { rerender } = render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        recordingSessionId="recording-1"
        client={client}
        durations={{ openSeconds: 1, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await flushPromises()

    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Maya Shah' },
    })
    fireEvent.change(screen.getByLabelText('Initials (optional)'), {
      target: { value: 'MS' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))

    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByRole('heading', { name: 'Eyes closed' })).toBeInTheDocument()

    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(2.8)}
        latestStreamTimestamp={2}
        recordingSessionId="recording-1"
        client={client}
        durations={{ openSeconds: 1, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })

    expect(screen.getByRole('heading', { name: 'Proof captured' })).toBeInTheDocument()
    expect(screen.getByText(/posterior alpha lift/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))

    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(3.2)}
        latestStreamTimestamp={3}
        recordingSessionId="recording-1"
        client={client}
        durations={{ openSeconds: 1, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    await flushPromises()

    expect(screen.getByRole('heading', { name: 'Room Constellation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dr Maya Shah star/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dr Maya Shah star/i }))
    expect(screen.getByText('Recording recording-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next participant' }))
    expect(screen.getByLabelText('Participant display name')).toHaveValue('')
    expect(createRun.mock.calls[0][1].recording_session_id).toBe('recording-1')

    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Changed Recording' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))
    await act(async () => vi.advanceTimersByTime(1_000))
    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(4)} latestStreamTimestamp={4}
        recordingSessionId="recording-2" client={client}
        durations={{ openSeconds: 1, closedSeconds: 1, challengeSeconds: 1 }} />,
    )
    await act(async () => vi.advanceTimersByTime(1_000))
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))
    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(5)} latestStreamTimestamp={5}
        recordingSessionId="recording-2" client={client}
        durations={{ openSeconds: 1, closedSeconds: 1, challengeSeconds: 1 }} />,
    )
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    await flushPromises()

    expect(createRun.mock.calls[1][1].recording_session_id).toBeNull()
  })

  it('pauses proof when calm features stop refreshing even while raw samples advance', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const client = makeClient([event])
    const staleCalm = calm(1.2)
    const { rerender } = render(
      <DoctorDemo
        board={streamingBoard}
        calm={staleCalm}
        latestStreamTimestamp={1}
        client={client}
        durations={{ openSeconds: 5, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await flushPromises()

    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Maya Shah' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))

    for (let timestamp = 2; timestamp <= 5; timestamp += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_000)
      })
      rerender(
        <DoctorDemo
          board={streamingBoard}
          calm={staleCalm}
          latestStreamTimestamp={timestamp}
          client={client}
          durations={{ openSeconds: 5, closedSeconds: 1, challengeSeconds: 1 }}
        />,
      )
    }

    expect(screen.getByRole('heading', { name: 'Eyes open' })).toBeInTheDocument()
    expect(screen.getAllByText('Signal paused — processed features are stale')).toHaveLength(2)

    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.3)}
        latestStreamTimestamp={6}
        client={client}
        durations={{ openSeconds: 5, closedSeconds: 1, challengeSeconds: 1 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })

    expect(screen.getByRole('heading', { name: 'Eyes closed' })).toBeInTheDocument()
  })

  it('keeps a saved run visible when the post-save constellation refresh fails', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const baseClient = makeClient([event])
    let runLoadCount = 0
    const client: DoctorDemoClient = {
      ...baseClient,
      demoRuns: async (eventId) => {
        runLoadCount += 1
        if (runLoadCount > 1) throw new Error('refresh failed')
        return baseClient.demoRuns(eventId)
      },
    }
    const createRun = vi.spyOn(client, 'createDemoRun')
    const { rerender } = render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await flushPromises()

    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Saved Once' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(2.8)}
        latestStreamTimestamp={2}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))
    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(3.2)}
        latestStreamTimestamp={3}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    await flushPromises()

    expect(createRun).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Room Constellation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dr Saved Once star/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Run saved, but other constellation results could not be refreshed',
    )
  })

  it('ignores an obsolete post-save refresh after the operator changes rooms', async () => {
    const firstEvent = { id: 'event-1', name: 'First room', created_at: '2026-08-12T08:00:00Z' }
    const secondEvent = { id: 'event-2', name: 'Second room', created_at: '2026-08-12T07:00:00Z' }
    const secondRun: DemoRun = {
      id: 'run-second',
      event_id: secondEvent.id,
      participant_name: 'Dr Second Room',
      participant_initials: 'SR',
      open_alpha: 1.1,
      closed_alpha: 2.2,
      alpha_lift_percent: 100,
      threshold_alpha: 1.8,
      clean_hold_seconds: 8,
      confidence: 0.9,
      score: 700,
      scoring_version: 'doctor-demo-v1',
      recording_session_id: null,
      completed_at: '2026-08-12T09:10:00Z',
      is_best: true,
    }
    let resolveOldRefresh: ((runs: DemoRun[]) => void) | undefined
    let firstRoomLoads = 0
    const client: DoctorDemoClient = {
      demoEvents: async () => [firstEvent, secondEvent],
      createDemoEvent: async () => firstEvent,
      demoRuns: async (eventId) => {
        if (eventId === secondEvent.id) return [secondRun]
        firstRoomLoads += 1
        if (firstRoomLoads === 1) return []
        return new Promise<DemoRun[]>((resolve) => {
          resolveOldRefresh = resolve
        })
      },
      createDemoRun: async (eventId, payload) => ({
        id: 'run-first',
        event_id: eventId,
        ...payload,
        recording_session_id: payload.recording_session_id ?? null,
        completed_at: '2026-08-12T09:05:00Z',
        is_best: true,
      }),
    }
    const { rerender } = render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await flushPromises()
    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr First Room' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))
    await act(async () => vi.advanceTimersByTime(250))
    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(2.8)} latestStreamTimestamp={2}
        client={client} durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }} />,
    )
    await act(async () => vi.advanceTimersByTime(250))
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))
    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(3.2)} latestStreamTimestamp={3}
        client={client} durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }} />,
    )
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Room Constellation' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next participant' }))
    fireEvent.change(screen.getByLabelText('Room'), { target: { value: secondEvent.id } })
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: 'View constellation' }))
    expect(screen.getByRole('button', { name: /Dr Second Room star/i })).toBeInTheDocument()

    await act(async () => {
      resolveOldRefresh?.([{
        ...secondRun,
        id: 'run-stale',
        event_id: firstEvent.id,
        participant_name: 'Dr Stale First Room',
      }])
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: /Dr Second Room star/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dr Stale First Room star/i })).not.toBeInTheDocument()
  })

  it('retries the same completed result after a transient save failure', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const baseClient = makeClient([event])
    let saveAttempts = 0
    const client: DoctorDemoClient = {
      ...baseClient,
      createDemoRun: async (eventId, payload) => {
        saveAttempts += 1
        if (saveAttempts === 1) throw new Error('temporary failure')
        return baseClient.createDemoRun(eventId, payload)
      },
    }
    const createRun = vi.spyOn(client, 'createDemoRun')
    const { rerender } = render(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(1.2)}
        latestStreamTimestamp={1}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await flushPromises()
    fireEvent.change(screen.getByLabelText('Participant display name'), {
      target: { value: 'Dr Retry Result' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))
    await act(async () => vi.advanceTimersByTime(250))
    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(2.8)}
        latestStreamTimestamp={2}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await act(async () => vi.advanceTimersByTime(250))
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))
    rerender(
      <DoctorDemo
        board={streamingBoard}
        calm={calm(3.2)}
        latestStreamTimestamp={3}
        client={client}
        durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    await flushPromises()

    expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
    expect(screen.getByText(/Result ready · \d+ points/i)).toBeInTheDocument()
    const firstPayload = createRun.mock.calls[0][1]
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await flushPromises()

    expect(createRun).toHaveBeenCalledTimes(2)
    expect(createRun.mock.calls[1][1]).toEqual(firstPayload)
    expect(screen.getByRole('heading', { name: 'Room Constellation' })).toBeInTheDocument()
  })

  it('selects the visible personal-best star after a lower repeat attempt', async () => {
    const event = { id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }
    const bestRun: DemoRun = {
      id: 'run-best', event_id: event.id, participant_name: 'Straße', participant_initials: 'SS',
      participant_key: 'strasse',
      open_alpha: 1.2, closed_alpha: 2.8, alpha_lift_percent: 133, threshold_alpha: 2.24,
      clean_hold_seconds: 20, confidence: 0.98, score: 999, scoring_version: 'doctor-demo-v1',
      recording_session_id: null, completed_at: '2026-08-12T08:30:00Z', is_best: true,
    }
    let latestRun: DemoRun | null = null
    const client: DoctorDemoClient = {
      demoEvents: async () => [event],
      createDemoEvent: async () => event,
      demoRuns: async () => latestRun ? [bestRun, latestRun] : [bestRun],
      createDemoRun: async (eventId, payload) => {
        latestRun = {
          id: 'run-lower', event_id: eventId, ...payload, score: 300,
          participant_key: 'strasse',
          recording_session_id: payload.recording_session_id ?? null,
          completed_at: '2026-08-12T09:30:00Z', is_best: false,
        }
        return latestRun
      },
    }
    const { rerender } = render(
      <DoctorDemo board={streamingBoard} calm={calm(1.2)} latestStreamTimestamp={1}
        client={client} durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }} />,
    )
    await flushPromises()
    fireEvent.change(screen.getByLabelText('Participant display name'), { target: { value: 'STRASSE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin proof' }))
    await act(async () => vi.advanceTimersByTime(250))
    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(2.8)} latestStreamTimestamp={2}
        client={client} durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }} />,
    )
    await act(async () => vi.advanceTimersByTime(250))
    fireEvent.click(screen.getByRole('button', { name: 'Start reactor' }))
    rerender(
      <DoctorDemo board={streamingBoard} calm={calm(3.2)} latestStreamTimestamp={3}
        client={client} durations={{ openSeconds: 0.25, closedSeconds: 0.25, challengeSeconds: 0.25 }} />,
    )
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    await flushPromises()

    expect(screen.getByRole('button', { name: /Straße star, score 999/i }))
      .toHaveClass('constellation-star--selected')
    expect(screen.getByText('999')).toBeInTheDocument()
    expect(screen.queryByText('300')).not.toBeInTheDocument()
  })
})
