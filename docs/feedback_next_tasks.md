# Feedback Demo Next Tasks

Nexus BCI is a local EEG workspace for education and research.

These are the highest-value next tasks while hardware testing is paused. They keep the product non-clinical and focus on transparent signal feedback that can be exercised with the BrainFlow synthetic board or saved recordings.

1. **Feedback state lab**
   Add a demo selector for calm trend, focus tone, and signal clarity so the same live or replay window can drive multiple visual feedback modes.

2. **Replay-first demo library**
   Curate short sanitized recordings for eyes-open, eyes-closed, noisy-contact, and motion-artifact examples so reviewers can exercise states without a headset.

3. **State confidence model**
   Centralize confidence gates for every demo state using sample count, channel coverage, signal quality, and artifact flags before any visual or audio interpretation moves.

4. **Focus tone prototype**
   Explore a relative beta/theta-alpha balance cue as a focus-oriented demo. Keep copy explicit that this is a band-balance visualization, not a diagnosis or attention measurement.

5. **Signal clarity mode**
   Make setup quality itself an engaging feedback target, rewarding stable channels and making bad/noisy channels visually obvious before calm or focus cues are shown.

6. **Soundscape envelopes**
   Expand the Web Audio pad into mode-specific envelopes: slower filtered pads for calm trend, brighter harmonics for focus tone, and sparse metronomic ticks for clarity confidence.

7. **Artifact-aware visuals**
   Detect and visualize common blocker states such as flatline, railing, line noise, high EEG-band RMS, and dropouts as paused or disrupted demo states.

8. **Baseline workflow polish**
   Add a short guided baseline checklist with accepted-window history, rejected-window reasons, and reset prompts when DSP settings or posterior channel selection changes.

9. **Comparison view**
   Let operators compare two saved windows side by side so they can see how band powers, quality, and demo states change between sessions.

10. **Hardware validation pass**
    When the headset is available, verify the demo states on the Cyton with repeatable short sessions and document where synthetic/replay behavior differs from live signal behavior.

## Candidate State Signals

- Calm trend: posterior alpha candidate lift with beta/gamma and line-noise penalties, gated by baseline and posterior signal quality.
- Focus tone: relative beta/theta-alpha balance from the current DSP window, gated by sample count and signal quality.
- Signal clarity: good-channel ratio, bad-channel penalty, sample coverage, and artifact flags.
- Restlessness/artifact: high motion-like RMS, dropouts, or railing should pause the demo rather than become a user-facing mental state.
- Eyes-open/eyes-closed contrast: useful as an operator demo with saved recordings, but should be framed as signal exploration rather than a user trait.
