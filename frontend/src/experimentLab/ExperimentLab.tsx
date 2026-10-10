import { useCallback, useEffect, useRef, useState } from 'react'
import { FlaskConical, Play, Square, Download, RefreshCw, BookOpen } from 'lucide-react'
import type { BoardState, RecordingState } from '../api'
import { api, recordingDownloadUrl } from '../api'
import { experimentApi, type Experiment, type ExperimentClient, type Readiness, type Report, type Trial } from './api'
import { downloadJson, mergeReports, nextLabel, presets, wait, type Preset } from './protocol'
import './ExperimentLab.css'
import { ClassifierLesson } from './lesson/ClassifierLesson'

type Props = {
  active: boolean
  board: BoardState
  onConsole: () => void
  onRecording: (value: RecordingState) => void
  client?: ExperimentClient
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Operation failed'
const percent = (value: number) => `${(value * 100).toFixed(1)}%`

function TrialRow({ trial, labels, disabled, onEdit }: {
  trial: Trial; labels: string[]; disabled: boolean
  onEdit: (trial: Trial, change: Partial<Pick<Trial, 'label' | 'included' | 'note'>>) => void
}) {
  const [note, setNote] = useState(trial.note)
  return <tr>
    <td><input type="checkbox" aria-label={`Include trial ${trial.id}`} checked={trial.included}
      disabled={disabled || trial.end_timestamp === null || trial.issues.length > 0}
      onChange={e => onEdit(trial, { included: e.target.checked })} /></td>
    <td><select aria-label={`Label for trial ${trial.id}`} value={trial.label}
      disabled={disabled || trial.end_timestamp === null} onChange={e => onEdit(trial, { label: e.target.value })}>
      {labels.map(label => <option key={label}>{label}</option>)}
    </select></td>
    <td>{trial.end_timestamp === null ? 'Incomplete' : `${(trial.end_timestamp - trial.start_timestamp).toFixed(1)} s`}</td>
    <td><input aria-label={`Note for trial ${trial.id}`} value={note}
      maxLength={300} disabled={disabled || trial.end_timestamp === null}
      placeholder="Blinked, moved, missed cue…" onChange={e => setNote(e.target.value)} /><button type="button" className="mini-button" disabled={disabled || trial.end_timestamp === null || note === trial.note}
      onClick={() => onEdit(trial, { note })}>Save note</button>{trial.issues.length > 0 && <small className="lab-warning">{trial.issues.join(', ').replaceAll('_', ' ')}</small>}</td>
  </tr>
}

export function ExperimentLab({ active, board, onConsole, onRecording, client = experimentApi }: Props) {
  const [showLesson, setShowLesson] = useState(false)
  const [sessionsReady, setSessionsReady] = useState(false)
  const [sessions, setSessions] = useState<Experiment[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [participant, setParticipant] = useState('P01')
  const [name, setName] = useState('Session 1')
  const [preset, setPreset] = useState<Preset>('eyes')
  const [customLabels, setCustomLabels] = useState('Quiet rest, Mental arithmetic')
  const [channels, setChannels] = useState<string[] | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [error, setError] = useState('')
  const [reportError, setReportError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'cue' | 'recording' | 'saving'>('idle')
  const [cue, setCue] = useState('')
  const [remaining, setRemaining] = useState(0)
  const [duration, setDuration] = useState(6)
  const [sound, setSound] = useState(true)
  const [trainId, setTrainId] = useState('')
  const [testId, setTestId] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const controller = useRef<AbortController | null>(null)
  const actionLock = useRef(false)
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const historyGeneration = useRef(0)
  const selected = sessions.find(session => session.session_id === selectedId)
  const live = sessions.find(session => session.status === 'recording')
  const running = phase !== 'idle'
  const displayPreset: Preset = live
    ? (Object.keys(presets) as Preset[]).find(key => presets[key].labels.join('|') === live.labels.join('|')) ?? 'custom'
    : preset
  const saved = sessions.filter(session => session.status === 'saved')
  const defaultChannels = presets[preset].channels.filter(c => board.eeg_names.includes(c))
  const chosenChannels = channels !== null ? channels : defaultChannels.length >= 2 ? defaultChannels : board.eeg_names.slice(0, 2)
  const labels = preset === 'custom' ? customLabels.split(',').map(s => s.trim()).filter(Boolean) : presets[preset].labels

  const update = useCallback((session: Experiment) => {
    // A mutation response supersedes snapshots requested before that mutation.
    refreshGeneration.current += 1
    setSessionsReady(true)
    setSessions(previous => [session, ...previous.filter(s => s.session_id !== session.session_id)])
  }, [])
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    const historyRequest = ++historyGeneration.current
    setSessionsReady(false)
    setReportError('')
    // Auxiliary result history must never block capture or saving a live recording.
    void client.reports().then(nextReports => {
      // Immutable snapshots can add useful history even if a newer request has started.
      if (mounted.current) {
        setReports(previous => mergeReports(previous, nextReports))
      }
    }).catch(() => {
      if (mounted.current && historyRequest === historyGeneration.current) {
        setReportError('Saved evaluation history could not be loaded. Recording controls remain available; refresh to retry.')
      }
    })
    try {
      const nextSessions = await client.list()
      if (!mounted.current || generation !== refreshGeneration.current) return
      setSessions(nextSessions)
      setSessionsReady(true)
      if (nextSessions.some(session => session.status === 'recording')) setShowLesson(false)
      setSelectedId(previous => previous || nextSessions[0]?.session_id || '')
    } catch (error) {
      // An obsolete request must not overwrite current data or its error state.
      if (mounted.current && generation === refreshGeneration.current) throw error
    }
  }, [client])
  const syncRecording = useCallback(async () => {
    const recording = await api.recording()
    if (mounted.current) onRecording(recording)
  }, [onRecording])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => {
    if (!active) {
      controller.current?.abort()
      return
    }
    let cancelled = false
    // Begin the asynchronous load without a synchronous effect-driven render.
    void Promise.resolve().then(() => {
      if (!cancelled) return refresh()
    }).catch(e => { if (!cancelled) setError(errorText(e)) })
    return () => { cancelled = true; refreshGeneration.current += 1 }
  }, [active, refresh])
  useEffect(() => {
    function hide() { if (document.hidden) controller.current?.abort() }
    function leave(event: BeforeUnloadEvent) {
      if (controller.current || live) { event.preventDefault(); event.returnValue = '' }
    }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('beforeunload', leave)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('beforeunload', leave)
    }
  }, [live])
  useEffect(() => {
    if (!active || !live) return
    let cancelled = false
    let pending = false
    const poll = async () => {
      if (pending) return
      pending = true
      try {
        const value = await client.readiness(live.session_id)
        if (!cancelled) {
          setReadiness(value)
          if (!value.ready) controller.current?.abort()
        }
      } catch (e) {
        if (!cancelled) {
          setReadiness(null)
          controller.current?.abort()
          setError(errorText(e))
          void refresh().catch(() => undefined)
        }
      } finally { pending = false }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 1000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [active, client, live?.session_id, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  async function action(work: () => Promise<void>) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(errorText(e)) }
    finally { actionLock.current = false; setBusy(false) }
  }
  async function create() {
    await action(async () => {
      const session = await client.create({ participant, name, labels, channels: chosenChannels })
      update(session); setSelectedId(session.session_id); setReadiness(null)
      await syncRecording()
    })
  }
  async function stop() {
    if (!live) return
    await action(async () => { update(await client.stop(live.session_id)); setReadiness(null); await syncRecording() })
  }
  async function capture() {
    if (!live || !readiness?.ready || actionLock.current || controller.current) return
    const session = live
    const label = nextLabel(session)
    const trialId = crypto.randomUUID()
    const control = new AbortController()
    controller.current = control
    let startRequested = false
    let finished = false
    setError(''); setCue(label); setPhase('cue')
    try {
      if (sound && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const speech = new SpeechSynthesisUtterance(label)
        speech.rate = 1
        window.speechSynthesis.speak(speech)
      }
      for (let seconds = 3; seconds > 0; seconds--) {
        setRemaining(seconds)
        await wait(1000, control.signal)
      }
      startRequested = true
      const started = await client.start(session.session_id, { id: trialId, label, duration_seconds: duration })
      if (control.signal.aborted) throw new DOMException('Trial interrupted', 'AbortError')
      update(started); setPhase('recording')
      const deadline = performance.now() + duration * 1000
      while (performance.now() < deadline) {
        setRemaining(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)))
        await wait(Math.min(100, Math.max(1, deadline - performance.now())), control.signal)
      }
      setPhase('saving')
      const completed = await client.finish(session.session_id, trialId, false)
      if (control.signal.aborted) throw new DOMException('Trial interrupted', 'AbortError')
      update(completed)
      finished = true
    } catch (e) {
      if (startRequested && !finished) {
        try { update(await client.finish(session.session_id, trialId, true)) }
        catch { setError('Trial status is uncertain. Refresh, then exclude any unfinished trial before continuing.') }
      }
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorText(e))
    } finally {
      controller.current = null
      if (sound && 'speechSynthesis' in window) window.speechSynthesis.cancel()
      if (mounted.current) { setPhase('idle'); setRemaining(0) }
    }
    if (finished && sound && 'speechSynthesis' in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance('Trial complete. Rest.'))
    }
  }
  async function edit(trial: Trial, change: Partial<Pick<Trial, 'label' | 'included' | 'note'>>) {
    if (!selected) return
    await action(async () => update(await client.edit(selected.session_id, trial.id, {
      label: trial.label, included: trial.included, note: trial.note, ...change,
    })))
  }
  async function evaluate() {
    await action(async () => {
      const result = await client.evaluate(trainId, testId)
      setReport(result); setReports(previous => mergeReports(previous, [result]))
    })
  }
  const pendingTrial = live?.trials.find(trial => trial.end_timestamp === null)

  if (showLesson && sessionsReady && !live) return <ClassifierLesson onClose={() => setShowLesson(false)} />

  return <section className="experiment-lab" aria-label="Experiment Lab">
    <header className="lab-heading">
      <div><h2><FlaskConical size={22} /> Experiment Lab</h2>
        <p>Collect labelled trials. Learn from one recording. Test on another.</p></div>
      <div className="button-row">
        <button type="button" disabled={!sessionsReady || !!live || running || busy} onClick={() => setShowLesson(true)}>
          <BookOpen size={16} />How the classifier works
        </button>
        <button type="button" onClick={onConsole}>Device &amp; live traces</button>
      </div>
    </header>
    <p className="lab-context">School research · local files · labels describe the task you attempted, not a verified mental state.</p>
    {board.board === 'synthetic' && <p className="lab-warning" role="status">Synthetic rehearsal: generated signals are not evidence of brain-state classification.</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="lab-columns">
      <section className="panel lab-card">
        <h3>1. Set up a recording</h3>
        <fieldset disabled={!!live || running || busy}>
          <label>Participant code<input value={live?.participant ?? participant} maxLength={60} onChange={e => setParticipant(e.target.value)} placeholder="P01" /></label>
          <label>Recording name<input value={live?.name ?? name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Day 1 — training" /></label>
          <label>Task preset<select value={displayPreset} onChange={e => { setPreset(e.target.value as Preset); setChannels(null) }}>
            {Object.entries(presets).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}
          </select></label>
          {displayPreset === 'custom' && <label>Task labels, separated by commas<input value={live?.labels.join(', ') ?? customLabels} onChange={e => setCustomLabels(e.target.value)} /></label>}
          <div><span>Electrodes used by the classifier</span><div className="lab-channels">
            {board.eeg_names.map(channel => <label key={channel}><input type="checkbox" checked={(live?.channels ?? chosenChannels).includes(channel)}
              onChange={e => setChannels(e.target.checked ? [...chosenChannels, channel] : chosenChannels.filter(c => c !== channel))} />{channel}</label>)}
          </div></div>
          <p>{presets[displayPreset].instruction}</p>
          <button type="button" onClick={() => void create()} disabled={board.status !== 'streaming' || chosenChannels.length < 2 || !participant.trim() || !name.trim() || labels.length < 2 || labels.length > 4 || new Set(labels).size !== labels.length}>
            Start labelled recording
          </button>
          {board.status !== 'streaming' && <small>Connect and start streaming in Console first.</small>}
        </fieldset>
        {live && <p className="lab-context">Recording: <strong>{live.name}</strong> · {live.participant} · {live.channels.join(', ')}</p>}
      </section>
      <section className="panel lab-card">
        <h3>2. Follow the cue</h3>
        <p>Each click chooses a task at random from those with the fewest accepted trials. Rest between trials. Aim for 20 trials per task.</p>
        <div className={`lab-cue ${running ? 'lab-cue--active' : ''}`} aria-live="polite" aria-atomic="true">
          <span>{phase === 'cue' ? 'Get ready' : phase === 'recording' ? 'Keep doing this task' : phase === 'saving' ? 'Saving trial' : 'Ready for the next trial'}</span>
          <strong>{running ? cue : 'Follow the next instruction'}</strong>
          <b>{running ? remaining : '—'}<small>{running ? ' seconds' : ''}</small></b>
        </div>
        <div className="lab-options">
          <label>Trial length<select value={duration} disabled={running || busy} onChange={e => setDuration(Number(e.target.value))}>
            {[6, 8, 10].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
          </select></label>
          <label className="lab-check"><input type="checkbox" checked={sound} disabled={running} onChange={e => setSound(e.target.checked)} />Speak cue</label>
        </div>
        {live && <p role="status">{readiness?.reason ?? 'Checking signal…'} · {readiness?.clean_windows ?? 0}/3 clean windows</p>}
        <div className="button-row">
          <button type="button" onClick={() => void capture()} disabled={!live || !readiness?.ready || running || busy || !!pendingTrial}><Play size={16} />Record next trial</button>
          <button type="button" onClick={() => controller.current?.abort()} disabled={!running}><Square size={16} />Stop &amp; exclude trial</button>
        </div>
        {pendingTrial && !running && <button type="button" disabled={busy} onClick={() => void action(async () => update(await client.finish(live!.session_id, pendingTrial.id, true)))}>Exclude interrupted trial</button>}
        {live && <div className="lab-counts">{live.labels.map(label => <span key={label}><b>{live.trials.filter(t => t.label === label && t.included && t.end_timestamp !== null).length}</b>{label}</span>)}</div>}
        <button type="button" disabled={!live || running || busy} onClick={() => void stop()}>Save recording</button>
        <small>Leaving this view or hiding the tab interrupts and excludes the current trial. Recording continues until you save it.</small>
      </section>
    </div>
    <section className="panel lab-card">
      <div className="lab-heading"><h3>3. Review labels</h3><button type="button" disabled={busy || running} onClick={() => { setError(''); void refresh().catch(e => setError(errorText(e))) }}><RefreshCw size={16} />Refresh</button></div>
      <label>Recording<select value={selectedId} disabled={running || busy} onChange={e => setSelectedId(e.target.value)}>
        <option value="">Select a recording</option>{sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.name} · {s.participant} · {s.status} · {new Date(s.created_at).toLocaleString()}</option>)}
      </select></label>
      {selected && <>
        <p>{selected.channels.join(', ')} · {selected.sampling_rate} Hz · {selected.board}. Uncheck trials with movement or missed instructions. Add a note to explain exclusions.</p>
        <div className="lab-table"><table><thead><tr><th>Include</th><th>Task label</th><th>Duration</th><th>Notes / issues</th></tr></thead>
          <tbody>{selected.trials.map(trial => <TrialRow key={trial.id} trial={trial} labels={selected.labels} disabled={busy || running} onEdit={(t, change) => void edit(t, change)} />)}</tbody>
        </table>{selected.trials.length === 0 && <p>No trials yet. Use Record next trial to label one automatically.</p>}</div>
        <div className="button-row">
          <button type="button" disabled={selected.status === 'recording'} onClick={() => downloadJson(selected, `${selected.session_id}-labels.json`)}><Download size={16} />Export labels</button>
          {selected.status !== 'recording' && <a href={recordingDownloadUrl(selected.session_id)}>Download raw EEG CSV</a>}
        </div>
      </>}
    </section>
    <section className="panel lab-card">
      <h3>4. Train &amp; test</h3>
      <p>Use two saved recordings from the same participant with identical electrodes and labels. A later day is a stronger test. Minimum after quality checks: 5 training and 2 test trials per task.</p>
      <div className="lab-columns">
        <label>Training recording<select value={trainId} disabled={busy} onChange={e => setTrainId(e.target.value)}><option value="">Choose training data</option>
          {saved.map(s => <option key={s.session_id} value={s.session_id}>{s.name} · {s.participant} · {s.session_id}</option>)}</select></label>
        <label>Test recording<select value={testId} disabled={busy} onChange={e => setTestId(e.target.value)}><option value="">Choose untouched test data</option>
          {saved.filter(s => s.session_id !== trainId).map(s => <option key={s.session_id} value={s.session_id}>{s.name} · {s.participant} · {s.session_id}</option>)}</select></label>
      </div>
      <button type="button" onClick={() => void evaluate()} disabled={busy || running || !trainId || !testId || trainId === testId}>{busy ? 'Working…' : 'Train pyRiemann & evaluate'}</button>
      <p className="lab-context">One 3-second EEG segment per trial, after 1 second of settling. 8–30 Hz filtering → covariance → tangent space → logistic regression. All fitting uses training data only.</p>
      {reportError && <p className="notice" role="status">{reportError}</p>}
      <label>Saved evaluation<select value={report?.id ?? ''} onChange={e => setReport(reports.find(r => r.id === e.target.value) ?? null)}>
        <option value="">Select a result</option>{reports.map(r => <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString()} · {r.participant} · {r.synthetic ? 'Synthetic rehearsal' : percent(r.balanced_accuracy)}</option>)}
      </select></label>
      {report && <div className="lab-result">
        {report.synthetic && <p className="lab-warning">SYNTHETIC REHEARSAL — these scores do not measure brain decoding.</p>}
        <div className="lab-counts">
          <span><b>{percent(report.balanced_accuracy)}</b>Balanced accuracy</span><span><b>{percent(report.accuracy)}</b>Accuracy</span><span><b>{percent(report.chance)}</b>Balanced chance</span>
          <span><b>{report.predictions.length}</b>Test trials</span><span><b>{Object.keys(report.rejected_trials).length}</b>Excluded trials</span>
        </div>
        <p>Confusion matrix: rows are actual tasks; columns are predicted tasks.</p>
        <div className="lab-table"><table><thead><tr><th>Actual / predicted</th>{report.classes.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{report.confusion_matrix.map((row, i) => <tr key={report.classes[i]}><th>{report.classes[i]}</th>{row.map((n, j) => <td key={j}>{n}</td>)}</tr>)}</tbody></table></div>
        <p>Training: {Object.entries(report.training_counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}<br />Test: {Object.entries(report.test_counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
        <details><summary>Predictions &amp; model probabilities</summary><p>These probabilities are not calibrated confidence or measures of mental state.</p>
          <div className="lab-table"><table><thead><tr><th>Actual task</th><th>Prediction</th><th>Probabilities</th></tr></thead><tbody>{report.predictions.map(p => <tr key={p.trial_id}><td>{p.actual}</td><td>{p.predicted}</td><td>{Object.entries(p.probabilities).map(([k, v]) => `${k}: ${percent(v)}`).join(' · ')}</td></tr>)}</tbody></table></div>
        </details>
        <details><summary>Excluded trial details</summary><ul>{Object.entries(report.rejected_trials).map(([id, issues]) => <li key={id}>{id}: {issues.join(', ')}</li>)}</ul></details>
        <p>Use this result as an estimate for this participant and recording. Repeatedly tuning against the test recording makes it development data; collect a fresh session for your final result.</p>
        <button type="button" onClick={() => downloadJson(report, `experiment-result-${report.id}.json`)}><Download size={16} />Export result &amp; method</button>
      </div>}
    </section>
  </section>
}
