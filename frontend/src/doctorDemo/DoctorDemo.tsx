import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Eye,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react'

import {
  api,
  type BoardState,
  type CalmFeatureResponse,
  type DemoEvent,
  type DemoRun,
  type DemoRunCreateRequest,
} from '../api'
import eyesClosedCueUrl from '../assets/audio/doctor-demo/eyes-closed.mp3'
import eyesOpenCueUrl from '../assets/audio/doctor-demo/eyes-open.mp3'
import reactorLoopUrl from '../assets/audio/doctor-demo/reactor-loop.mp3'
import {
  calculateAlphaProof,
  calculateChallengeScore,
  deriveSignalGate,
  type AlphaProof,
} from './model'
import './DoctorDemo.css'

export type DoctorDemoClient = Pick<
  typeof api,
  'demoEvents' | 'createDemoEvent' | 'demoRuns' | 'createDemoRun'
>

type DemoPhase =
  | 'intake'
  | 'proof-open'
  | 'proof-closed'
  | 'proof-result'
  | 'challenge'
  | 'saving'
  | 'save-failed'
  | 'constellation'

type DemoDurations = {
  openSeconds: number
  closedSeconds: number
  challengeSeconds: number
}

type DoctorDemoProps = {
  active?: boolean
  board: BoardState
  calm: CalmFeatureResponse | null
  latestStreamTimestamp: number | null
  recordingSessionId?: string | null
  client?: DoctorDemoClient
  durations?: DemoDurations
}

const defaultDurations: DemoDurations = {
  openSeconds: 10,
  closedSeconds: 15,
  challengeSeconds: 30,
}
const tickSeconds = 0.25

function formatAlpha(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value)}%`
}

function formatCompletedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function participantKey(run: DemoRun): string {
  return run.participant_key ?? run.participant_name.trim().toLocaleLowerCase()
}

function isBestRunForParticipant(run: DemoRun, canonicalParticipantKey: string): boolean {
  return run.is_best && participantKey(run) === canonicalParticipantKey
}

function createClientRunId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `doctor-run-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function DoctorDemo({
  active = true,
  board,
  calm,
  latestStreamTimestamp,
  recordingSessionId = null,
  client = api,
  durations = defaultDurations,
}: DoctorDemoProps) {
  const [events, setEvents] = useState<DemoEvent[]>([])
  const [eventId, setEventId] = useState('')
  const [runs, setRuns] = useState<DemoRun[]>([])
  const [roomName, setRoomName] = useState('')
  const [participantName, setParticipantName] = useState('')
  const [participantInitials, setParticipantInitials] = useState('')
  const [phase, setPhase] = useState<DemoPhase>('intake')
  const [stageElapsed, setStageElapsed] = useState(0)
  const [proof, setProof] = useState<AlphaProof | null>(null)
  const [cleanWindowCount, setCleanWindowCount] = useState(0)
  const [cleanHoldSeconds, setCleanHoldSeconds] = useState(0)
  const [reactorCharge, setReactorCharge] = useState(0)
  const [pendingRun, setPendingRun] = useState<DemoRunCreateRequest | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [lastAdvancedAtMs, setLastAdvancedAtMs] = useState<number | null>(() =>
    latestStreamTimestamp === null ? null : Date.now(),
  )
  const [lastFeatureAdvancedAtMs, setLastFeatureAdvancedAtMs] = useState<number | null>(() =>
    typeof calm?.source_timestamp === 'number' ? Date.now() : null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [audioError, setAudioError] = useState<string | null>(null)
  const lastTimestampRef = useRef<number | null>(latestStreamTimestamp)
  const eventIdRef = useRef(eventId)
  const lastFeatureMarkerRef = useRef<number | null>(calm?.source_timestamp ?? null)
  const lastProcessedFeatureMarkerRef = useRef<number | null>(null)
  const openWindowsRef = useRef<number[]>([])
  const closedWindowsRef = useRef<number[]>([])
  const confidenceTotalRef = useRef(0)
  const confidenceWindowsRef = useRef(0)
  const bestChallengeLiftRef = useRef(0)
  const completingRef = useRef(false)
  const proofRecordingSessionIdRef = useRef<string | null>(null)
  const cleanHoldSecondsRef = useRef(0)
  const cueAudioRef = useRef<HTMLAudioElement | null>(null)
  const cueAudioSourceRef = useRef<string | null>(null)
  const cuePrimedRef = useRef(false)
  const reactorAudioRef = useRef<HTMLAudioElement | null>(null)
  const lastCuePhaseRef = useRef<'proof-open' | 'proof-closed' | null>(null)

  const alphaPost = calm?.features.alpha_post
  const confidence = calm?.confidence ?? 0
  const selectedEvent = events.find((event) => event.id === eventId) ?? null
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
  const bestRuns = useMemo(() => {
    const seen = new Set<string>()
    return runs.filter((run) => {
      const key = participantKey(run)
      if (!run.is_best || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [runs])
  const gate = deriveSignalGate({
    boardStatus: board.status,
    signalState: calm?.signal_state,
    confidence,
    alphaPost,
    lastAdvancedAtMs,
    lastFeatureAdvancedAtMs,
    nowMs,
  })
  const liveFeatureRef = useRef({ calm, alphaPost, confidence, gateOpen: gate.open })

  const pauseCueAudio = useCallback(() => {
    const audio = cueAudioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }, [])

  const stopCueAudio = useCallback(() => {
    pauseCueAudio()
    cueAudioRef.current = null
    cueAudioSourceRef.current = null
    cuePrimedRef.current = false
  }, [pauseCueAudio])

  const stopReactorAudio = useCallback(() => {
    const audio = reactorAudioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    reactorAudioRef.current = null
  }, [])

  const playCue = useCallback((src: string) => {
    let audio = cueAudioRef.current
    if (!audio || cueAudioSourceRef.current !== src) {
      stopCueAudio()
      audio = new Audio(src)
      cueAudioRef.current = audio
      cueAudioSourceRef.current = src
    } else {
      audio.pause()
      audio.currentTime = 0
    }
    audio.preload = 'auto'
    audio.volume = 0.95
    cuePrimedRef.current = false
    setAudioError(null)
    void audio.play().catch((playError: unknown) => {
      if (!isAbortError(playError) && cueAudioRef.current === audio) {
        setAudioError('Audio was blocked. Press Sound off, then Sound on to enable it.')
      }
    })
  }, [stopCueAudio])

  const primeCueAudio = useCallback((src: string) => {
    stopCueAudio()
    const audio = new Audio(src)
    audio.preload = 'auto'
    audio.volume = 0
    cueAudioRef.current = audio
    cueAudioSourceRef.current = src
    cuePrimedRef.current = true
    void audio.play().catch((playError: unknown) => {
      if (!isAbortError(playError) && cueAudioRef.current === audio) {
        setAudioError('Audio was blocked. Press Sound off, then Sound on to enable it.')
      }
    })
  }, [stopCueAudio])

  const startReactorAudio = useCallback((initialVolume: number) => {
    stopReactorAudio()
    const audio = new Audio(reactorLoopUrl)
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = initialVolume
    reactorAudioRef.current = audio
    void audio.play().catch(() => {
      if (reactorAudioRef.current === audio) {
        setAudioError('Audio was blocked. Press Sound off, then Sound on to enable it.')
      }
    })
  }, [stopReactorAudio])

  useEffect(() => {
    liveFeatureRef.current = { calm, alphaPost, confidence, gateOpen: gate.open }
  }, [alphaPost, calm, confidence, gate.open])

  useEffect(() => {
    if (!active || !audioEnabled) {
      if (!active && audioEnabled) pauseCueAudio()
      else stopCueAudio()
      lastCuePhaseRef.current = null
      return
    }
    if ((phase === 'proof-open' || phase === 'proof-closed') && !gate.open) {
      if (!cuePrimedRef.current) pauseCueAudio()
      lastCuePhaseRef.current = null
      return
    }
    if (phase === 'proof-open' || phase === 'proof-closed') {
      if (lastCuePhaseRef.current !== phase) {
        playCue(phase === 'proof-open' ? eyesOpenCueUrl : eyesClosedCueUrl)
        lastCuePhaseRef.current = phase
      }
      return
    }
    stopCueAudio()
    lastCuePhaseRef.current = null
  }, [active, audioEnabled, gate.open, pauseCueAudio, phase, playCue, stopCueAudio])

  useEffect(() => {
    const audio = reactorAudioRef.current
    if (!active || !audioEnabled || phase !== 'challenge') {
      if (audio) stopReactorAudio()
      return
    }
    const gatedVolume = gate.open ? 0.28 + reactorCharge * 0.42 : 0
    if (!audio) {
      startReactorAudio(gatedVolume)
      return
    }
    audio.volume = gatedVolume
    audio.playbackRate = 0.94 + reactorCharge * 0.12
  }, [active, audioEnabled, gate.open, phase, reactorCharge, startReactorAudio, stopReactorAudio])

  useEffect(() => () => {
    stopCueAudio()
    stopReactorAudio()
  }, [stopCueAudio, stopReactorAudio])

  useEffect(() => {
    let cancelled = false
    client
      .demoEvents()
      .then((nextEvents) => {
        if (cancelled) return
        setEvents(nextEvents)
        setEventId((current) => current || nextEvents[0]?.id || '')
      })
      .catch(() => {
        if (!cancelled) setError('Saved demo rooms could not be loaded')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    if (!eventId) return
    eventIdRef.current = eventId
    let cancelled = false
    client
      .demoRuns(eventId)
      .then((nextRuns) => {
        if (!cancelled) setRuns(nextRuns)
      })
      .catch(() => {
        if (!cancelled) {
          setRuns([])
          setSelectedRunId(null)
          setError('Saved constellation results could not be loaded')
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, eventId])

  useEffect(() => {
    if (
      latestStreamTimestamp !== null &&
      latestStreamTimestamp !== lastTimestampRef.current
    ) {
      lastTimestampRef.current = latestStreamTimestamp
      setLastAdvancedAtMs(Date.now())
    }
  }, [latestStreamTimestamp])

  useEffect(() => {
    const marker = calm?.source_timestamp
    if (typeof marker === 'number' && marker !== lastFeatureMarkerRef.current) {
      lastFeatureMarkerRef.current = marker
      setLastFeatureAdvancedAtMs(Date.now())
    }
  }, [calm])

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [])

  const saveCompletedRun = useCallback(
    async (payload: DemoRunCreateRequest) => {
      if (!eventId || completingRef.current) return
      completingRef.current = true
      setPhase('saving')
      setError(null)
      try {
        const savedRun = await client.createDemoRun(eventId, payload)
        setRuns((current) => [savedRun, ...current.filter((run) => run.id !== savedRun.id)])
        const existingBest = runs.find((run) =>
          isBestRunForParticipant(run, participantKey(savedRun)),
        )
        setSelectedRunId(savedRun.is_best ? savedRun.id : existingBest?.id ?? null)
        setPendingRun(null)
        setPhase('constellation')
        try {
          const nextRuns = await client.demoRuns(eventId)
          if (eventIdRef.current === eventId) {
            setRuns(nextRuns)
            const displayedBest = nextRuns.find((run) =>
              isBestRunForParticipant(run, participantKey(savedRun)),
            )
            setSelectedRunId(displayedBest?.id ?? null)
          }
        } catch {
          if (eventIdRef.current === eventId) {
            setError('Run saved, but other constellation results could not be refreshed')
          }
        }
      } catch {
        setError('The completed result could not be saved locally. Retry when ready.')
        setPhase('save-failed')
      } finally {
        completingRef.current = false
      }
    }, [client, eventId, runs],
  )

  const finishChallenge = useCallback(
    async (finalHoldSeconds: number) => {
      if (!proof || !eventId || completingRef.current) return
      const averageConfidence =
        confidenceWindowsRef.current > 0
          ? confidenceTotalRef.current / confidenceWindowsRef.current
          : 0
      const finalLift = Math.max(proof.alphaLiftPercent, bestChallengeLiftRef.current)
      const score = calculateChallengeScore({
        alphaLiftPercent: finalLift,
        cleanHoldSeconds: finalHoldSeconds,
        challengeDurationSeconds: durations.challengeSeconds,
        confidence: averageConfidence,
      })
      const payload: DemoRunCreateRequest = {
        client_run_id: createClientRunId(),
        participant_name: participantName.trim(),
        participant_initials: participantInitials.trim().toUpperCase() || null,
        open_alpha: proof.openAlpha,
        closed_alpha: proof.closedAlpha,
        alpha_lift_percent: finalLift,
        threshold_alpha: proof.thresholdAlpha,
        clean_hold_seconds: finalHoldSeconds,
        confidence: averageConfidence,
        score: score.score,
        scoring_version: score.scoringVersion,
        recording_session_id:
          proofRecordingSessionIdRef.current === recordingSessionId
            ? proofRecordingSessionIdRef.current
            : null,
      }
      setPendingRun(payload)
      await saveCompletedRun(payload)
    }, [durations.challengeSeconds, eventId, participantInitials, participantName, proof, recordingSessionId, saveCompletedRun],
  )

  useEffect(() => {
    if (!active || !['proof-open', 'proof-closed', 'challenge'].includes(phase)) return undefined

    const interval = window.setInterval(() => {
      const live = liveFeatureRef.current
      if (!live.gateOpen || typeof live.alphaPost !== 'number') return

      const featureMarker = live.calm?.source_timestamp
      const hasNewFeatures =
        typeof featureMarker === 'number' &&
        featureMarker !== lastProcessedFeatureMarkerRef.current
      if (hasNewFeatures) lastProcessedFeatureMarkerRef.current = featureMarker

      if (phase === 'proof-open' && hasNewFeatures) {
        openWindowsRef.current.push(live.alphaPost)
        setCleanWindowCount(openWindowsRef.current.length)
      }
      if (phase === 'proof-closed' && hasNewFeatures) {
        closedWindowsRef.current.push(live.alphaPost)
        setCleanWindowCount(closedWindowsRef.current.length)
      }

      if (phase === 'challenge' && proof) {
        if (hasNewFeatures) {
          const lift = proof.openAlpha > 0 ? ((live.alphaPost - proof.openAlpha) / proof.openAlpha) * 100 : 0
          bestChallengeLiftRef.current = Math.max(bestChallengeLiftRef.current, lift)
          confidenceTotalRef.current += live.confidence
          confidenceWindowsRef.current += 1
          setReactorCharge(Math.min(1, Math.max(0, live.alphaPost / Math.max(proof.thresholdAlpha, 0.000001))))
        }
        if (live.alphaPost >= proof.thresholdAlpha) {
          cleanHoldSecondsRef.current += tickSeconds
          setCleanHoldSeconds(cleanHoldSecondsRef.current)
        }
      }

      setStageElapsed((current) => {
        const next = current + tickSeconds
        const target =
          phase === 'proof-open'
            ? durations.openSeconds
            : phase === 'proof-closed'
              ? durations.closedSeconds
              : durations.challengeSeconds

        if (next < target) return next

        if (phase === 'proof-open') {
          setPhase('proof-closed')
          setCleanWindowCount(0)
        } else if (phase === 'proof-closed') {
          setProof(calculateAlphaProof(openWindowsRef.current, closedWindowsRef.current))
          setPhase('proof-result')
        } else {
          void finishChallenge(cleanHoldSecondsRef.current)
        }
        return 0
      })
    }, tickSeconds * 1000)

    return () => window.clearInterval(interval)
  }, [active, durations, finishChallenge, phase, proof])

  async function createRoom() {
    if (!roomName.trim()) return
    setError(null)
    try {
      const event = await client.createDemoEvent({ name: roomName.trim() })
      setEvents((current) => [event, ...current])
      setRuns([])
      setSelectedRunId(null)
      eventIdRef.current = event.id
      setEventId(event.id)
      setRoomName('')
    } catch {
      setError('The room could not be saved locally')
    }
  }

  function beginProof() {
    if (!participantName.trim() || !eventId) return
    setAudioError(null)
    if (audioEnabled) {
      if (gate.open) {
        lastCuePhaseRef.current = 'proof-open'
        playCue(eyesOpenCueUrl)
      } else {
        primeCueAudio(eyesOpenCueUrl)
      }
    }
    openWindowsRef.current = []
    closedWindowsRef.current = []
    lastProcessedFeatureMarkerRef.current = null
    proofRecordingSessionIdRef.current = recordingSessionId
    setProof(null)
    setCleanWindowCount(0)
    setCleanHoldSeconds(0)
    cleanHoldSecondsRef.current = 0
    setPendingRun(null)
    setReactorCharge(0)
    setStageElapsed(0)
    setError(null)
    setPhase('proof-open')
  }

  function startChallenge() {
    setAudioError(null)
    stopCueAudio()
    lastCuePhaseRef.current = null
    if (audioEnabled) startReactorAudio(gate.open ? 0.28 : 0)
    confidenceTotalRef.current = 0
    confidenceWindowsRef.current = 0
    bestChallengeLiftRef.current = 0
    setCleanHoldSeconds(0)
    cleanHoldSecondsRef.current = 0
    setPendingRun(null)
    setReactorCharge(0)
    setStageElapsed(0)
    setPhase('challenge')
  }

  function returnToSetup() {
    stopCueAudio()
    lastCuePhaseRef.current = null
    openWindowsRef.current = []
    closedWindowsRef.current = []
    lastProcessedFeatureMarkerRef.current = null
    setProof(null)
    setCleanWindowCount(0)
    setStageElapsed(0)
    setAudioError(null)
    setPhase('intake')
  }

  function nextParticipant() {
    stopCueAudio()
    stopReactorAudio()
    lastCuePhaseRef.current = null
    setParticipantName('')
    setParticipantInitials('')
    setSelectedRunId(null)
    setProof(null)
    setCleanWindowCount(0)
    setStageElapsed(0)
    setCleanHoldSeconds(0)
    cleanHoldSecondsRef.current = 0
    setPendingRun(null)
    proofRecordingSessionIdRef.current = null
    setPhase('intake')
  }

  function viewConstellation() {
    if (!bestRuns.length) return
    setSelectedRunId(bestRuns[0].id)
    setPhase('constellation')
  }

  function toggleAudio() {
    const nextEnabled = !audioEnabled
    setAudioEnabled(nextEnabled)
    setAudioError(null)
    if (!nextEnabled) {
      stopCueAudio()
      stopReactorAudio()
      lastCuePhaseRef.current = null
      return
    }
    if (phase === 'proof-open' || phase === 'proof-closed') {
      if (gate.open) {
        lastCuePhaseRef.current = phase
        playCue(phase === 'proof-open' ? eyesOpenCueUrl : eyesClosedCueUrl)
      } else {
        primeCueAudio(phase === 'proof-open' ? eyesOpenCueUrl : eyesClosedCueUrl)
      }
    }
    if (phase === 'challenge') {
      startReactorAudio(gate.open ? 0.28 + reactorCharge * 0.42 : 0)
    }
  }

  if (loading) {
    return <section className="doctor-demo doctor-demo--loading">Loading local demo rooms…</section>
  }

  const stageTarget =
    phase === 'proof-open'
      ? durations.openSeconds
      : phase === 'proof-closed'
        ? durations.closedSeconds
        : durations.challengeSeconds
  const remainingSeconds = Math.max(0, stageTarget - stageElapsed)

  return (
    <section className={`doctor-demo doctor-demo--${phase}`} aria-label="Doctor Demo experience">
      <header className="doctor-demo__header">
        <div>
          <span>Dr K’s EEG Lab · live EEG experience</span>
          <h2>{selectedEvent?.name ?? 'Create a demo room'}</h2>
        </div>
        <div className="doctor-demo__header-controls">
          <div className={`doctor-demo__gate ${gate.open ? 'doctor-demo__gate--open' : ''}`}>
            <Radio size={14} />
            {gate.reason}
          </div>
          <button
            type="button"
            className="doctor-demo__audio-toggle"
            aria-label={audioEnabled ? 'Mute Doctor Demo audio' : 'Enable Doctor Demo audio'}
            aria-pressed={audioEnabled}
            onClick={toggleAudio}
          >
            {audioEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            {audioEnabled ? 'Sound on' : 'Sound off'}
          </button>
        </div>
      </header>

      {error ? <div className="doctor-demo__notice" role="alert">{error}</div> : null}
      {audioError ? <div className="doctor-demo__audio-notice" role="status">{audioError}</div> : null}

      {phase === 'intake' ? (
        <div className="doctor-intake">
          <div className="doctor-intake__intro">
            <Sparkles size={28} />
            <h3>Prove it. Hold it. Leave a star.</h3>
            <p>
              Capture a personal eyes-open/eyes-closed alpha response, then hold a clean
              signal above your own threshold. This is an EEG demonstration, not a clinical
              assessment.
            </p>
          </div>
          <div className="doctor-intake__form">
            {events.length ? (
              <label>
                <span>Room</span>
                <select
                  name="doctor-demo-room"
                  value={eventId}
                  onChange={(event) => {
                    setRuns([])
                    setSelectedRunId(null)
                    setError(null)
                    eventIdRef.current = event.target.value
                    setEventId(event.target.value)
                  }}
                >
                  {events.map((event) => (
                    <option value={event.id} key={event.id}>{event.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="doctor-intake__new-room">
              <label>
                <span>New room name</span>
                <input
                  aria-label="New room name"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  placeholder="Science evening"
                />
              </label>
              <button type="button" onClick={() => void createRoom()} disabled={!roomName.trim()}>
                <Plus size={15} /> Create room
              </button>
            </div>
            {selectedEvent ? (
              <>
                <label>
                  <span>Participant display name</span>
                  <input
                    aria-label="Participant display name"
                    value={participantName}
                    onChange={(event) => setParticipantName(event.target.value)}
                    placeholder="Dr Maya Shah"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span>Initials (optional)</span>
                  <input
                    aria-label="Initials (optional)"
                    value={participantInitials}
                    onChange={(event) => setParticipantInitials(event.target.value.slice(0, 8))}
                    placeholder="MS"
                    autoComplete="off"
                  />
                </label>
                <div className="doctor-intake__summary">
                  <strong>{bestRuns.length}</strong>
                  <span>stars already saved in this room</span>
                </div>
                {bestRuns.length ? (
                  <button type="button" onClick={viewConstellation}>
                    <Trophy size={16} /> View constellation
                  </button>
                ) : null}
                <div
                  className="doctor-intake__readiness"
                  role="status"
                  aria-label="Proof readiness"
                  aria-live="polite"
                >
                  <div className={participantName.trim() ? 'is-ready' : ''}>
                    <span>1 · Participant</span>
                    <strong>{participantName.trim() ? 'Participant ready' : 'Name required'}</strong>
                  </div>
                  <div className={gate.open ? 'is-ready' : 'needs-attention'}>
                    <span>2 · Live signal</span>
                    <strong>{gate.open ? 'Signal ready' : 'Signal needs attention'}</strong>
                  </div>
                  <small>
                    Confidence {Math.round(confidence * 100)}%
                    {calm?.flags.length
                      ? ` · ${calm.flags.map((flag) => flag.replaceAll('_', ' ')).join(' · ')}`
                      : ''}
                  </small>
                  {!gate.open ? <p>{gate.reason}</p> : null}
                  {participantName.trim() && !gate.open ? (
                    <em>You can begin now; timing will wait for clean signal.</em>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="doctor-demo__primary"
                  onClick={beginProof}
                  disabled={!participantName.trim()}
                >
                  <Eye size={17} /> Begin proof
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === 'proof-open' || phase === 'proof-closed' ? (
        <div className="alpha-proof">
          <div className="alpha-proof__orb" aria-hidden="true"><Eye size={42} /></div>
          <span>Personal response proof</span>
          <h3>{phase === 'proof-open' ? 'Eyes open' : 'Eyes closed'}</h3>
          <p>{phase === 'proof-open' ? 'Look softly ahead and stay still.' : 'Close your eyes and keep your jaw relaxed.'}</p>
          <strong>{remainingSeconds.toFixed(1)}s</strong>
          <div className="alpha-proof__evidence">
            <span>Posterior alpha <b>{formatAlpha(alphaPost)}</b></span>
            <span>Confidence <b>{Math.round(confidence * 100)}%</b></span>
            <span>Clean windows <b>{cleanWindowCount}</b></span>
          </div>
          {!gate.open ? (
            <div className="alpha-proof__paused">
              <strong>{gate.reason}</strong>
              <span>Timing starts automatically when the signal is ready.</span>
            </div>
          ) : null}
          <button type="button" className="alpha-proof__back" onClick={returnToSetup}>
            <RotateCcw size={15} /> Back to setup
          </button>
        </div>
      ) : null}

      {phase === 'proof-result' && proof ? (
        <div className="proof-result">
          <Sparkles size={30} />
          <h3>Proof captured</h3>
          <p>
            {participantName}'s posterior alpha lift was {formatPercent(proof.alphaLiftPercent)}
            between the two clean conditions.
          </p>
          <div className="proof-result__metrics">
            <span><b>{formatAlpha(proof.openAlpha)}</b> eyes open</span>
            <span><b>{formatAlpha(proof.closedAlpha)}</b> eyes closed</span>
            <span><b>{formatAlpha(proof.thresholdAlpha)}</b> personal target</span>
          </div>
          <button type="button" className="doctor-demo__primary" onClick={startChallenge}>
            <Play size={17} /> Start reactor
          </button>
        </div>
      ) : null}

      {phase === 'challenge' || phase === 'saving' || phase === 'save-failed' ? (
        <div className="reactor-screen">
          <div className="reactor-screen__identity">
            <span>{participantName}</span>
            <b>{gate.open ? 'Gate open' : 'Paused'} · {Math.round(confidence * 100)}%</b>
          </div>
          <div className="reactor" style={{ '--reactor-charge': reactorCharge } as CSSProperties}>
            <div className="reactor__rings" aria-hidden="true"><div /><div /><div /></div>
            <div className="reactor__core">
              <span>{phase === 'saving' ? 'CRYSTALLIZING' : phase === 'save-failed' ? 'RESULT READY' : 'HOLD'}</span>
              <strong>{cleanHoldSeconds.toFixed(1)}s</strong>
            </div>
          </div>
          <div className="reactor-screen__hud">
            <span><small>Reactor charge</small><b>{Math.round(reactorCharge * 100)}%</b></span>
            <span>
              <small>{phase === 'save-failed' ? 'Challenge points' : 'Time remaining'}</small>
              <b>{phase === 'save-failed' ? pendingRun?.score ?? 0 : `${remainingSeconds.toFixed(1)}s`}</b>
            </span>
            <span><small>Personal target</small><b>{formatAlpha(proof?.thresholdAlpha)}</b></span>
            <span><small>Posterior alpha</small><b>{formatAlpha(alphaPost)}</b></span>
          </div>
          {phase === 'save-failed' && pendingRun ? (
            <div className="reactor-screen__retry">
              <span>
                Result ready · {pendingRun.score} points · {pendingRun.clean_hold_seconds.toFixed(1)}s clean hold
              </span>
              <button type="button" className="doctor-demo__primary" onClick={() => void saveCompletedRun(pendingRun)}>
                Retry save
              </button>
            </div>
          ) : null}
          {!gate.open ? <div className="reactor-screen__paused">{gate.reason}</div> : null}
        </div>
      ) : null}

      {phase === 'constellation' ? (
        <div className="room-constellation">
          <div className="room-constellation__topline">
            <div><Trophy size={20} /><h3>Room Constellation</h3></div>
            <button type="button" onClick={nextParticipant}><RotateCcw size={15} /> Next participant</button>
          </div>
          <div className="constellation-field">
            <svg viewBox="0 0 1000 540" aria-hidden="true">
              <defs>
                <radialGradient id="doctorSpace"><stop stopColor="#25275e" /><stop offset="1" stopColor="#070a12" /></radialGradient>
              </defs>
              <rect width="1000" height="540" fill="url(#doctorSpace)" />
              <path d="M90 390 L220 300 L350 350 L500 205 L650 300 L790 150 L920 245" />
            </svg>
            {bestRuns.map((run, index) => {
              const angle = (index / Math.max(1, bestRuns.length)) * Math.PI * 2 - Math.PI / 2
              const radius = 32 + Math.min(24, run.score / 50)
              const left = 50 + Math.cos(angle) * (index % 2 ? 33 : 25)
              const top = 49 + Math.sin(angle) * (index % 2 ? 32 : 24)
              return (
                <button
                  type="button"
                  className={`constellation-star ${selectedRunId === run.id ? 'constellation-star--selected' : ''}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: radius, height: radius }}
                  aria-label={`${run.participant_name} star, score ${run.score}`}
                  onClick={() => setSelectedRunId(run.id)}
                  key={run.id}
                ><span>{run.participant_initials || run.participant_name.slice(0, 2)}</span></button>
              )
            })}
          </div>
          {selectedRun ? (
            <div className="constellation-evidence">
              <div><small>Selected star</small><strong>{selectedRun.participant_name}</strong></div>
              <div><small>Challenge points</small><strong>{selectedRun.score}</strong></div>
              <div><small>Personal alpha lift</small><strong>{formatPercent(selectedRun.alpha_lift_percent)}</strong></div>
              <div><small>Best clean hold</small><strong>{selectedRun.clean_hold_seconds.toFixed(1)} sec</strong></div>
              <div><small>Confidence</small><strong>{Math.round(selectedRun.confidence * 100)}%</strong></div>
              <div><small>Completed</small><strong>{formatCompletedAt(selectedRun.completed_at)}</strong></div>
              {selectedRun.recording_session_id ? <div><small>Evidence</small><strong>Recording {selectedRun.recording_session_id}</strong></div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
