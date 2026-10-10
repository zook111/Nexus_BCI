# Lyria Demo Sound Prompt Pack

Nexus BCI is created and maintained by **[zook111](https://github.com/zook111)**.

This prompt pack is for generating optional source loops for Nexus Feedback Lab demos with Gemini/Lyria 3. The app has a confidence-gated Web Audio ambient pad, guided calibration cue audio, and a small bundled set of generated demo loops that can be selected from the Feedback Lab Ambient pad card.

Source note: Google's Gemini Lyria overview describes prompt/media-based music generation, 30-second Lyria 3 tracks, longer Pro tracks for paid plans, MP3/MP4 downloads, and SynthID watermarking for generated audio: <https://gemini.google/gp/overview/music-generation/>.

## Prompting Rules

- Use original style descriptions only. Do not mention artist names, song titles, labels, or copyrighted works.
- Request instrumental-only output unless intentionally testing speech-bed behavior.
- Keep generated tracks non-clinical: relaxation/focus/clarity demo sound, not treatment, therapy, stress detection, or diagnosis.
- Favor loops that remain comfortable at low volume and do not distract from signal traces, visual feedback, or spoken calibration cues.
- Generate at least 3 candidates per prompt, then shortlist by listening rather than keeping the first acceptable output.

## Prompt Pack

### Calm Trend

```text
Create a 30-second seamless instrumental loop for a neurofeedback relaxation demo. Forest bath mood, soft mossy ambience, distant warm pads, gentle water movement, slow breath-like pulse, no vocals, no lyrics, no percussion, no sudden changes, calming but not sleepy, suitable as quiet background audio.
```

### Focus Tone

```text
Create a 30-second seamless instrumental loop for a focus demo. Minimal organic-electronic forest texture, soft marimba-like droplets, light filtered synth pulse, steady but gentle forward motion, no vocals, no lyrics, no drums, no sharp transients, clear and attentive without sounding tense.
```

### Signal Clarity

```text
Create a 30-second seamless instrumental loop for a signal clarity demo. Clean airy ambient tone, subtle bell harmonics, soft wind-through-trees texture, sparse low warm drone, no vocals, no lyrics, no beat, no dramatic melody, polished and transparent.
```

### Confidence Gate Open

```text
Create a very gentle 30-second instrumental cue bed for a biofeedback interface when the signal becomes usable. Forest bath ambience, soft harmonic bloom in the first 3 seconds, then stable quiet texture, no vocals, no lyrics, no drums, no alarm feeling, reassuring and neutral.
```

### Paused / Low Confidence

```text
Create a 30-second seamless instrumental loop for a paused signal state. Very sparse forest ambience, soft low air, distant leaves, muted tonal center, minimal movement, no vocals, no lyrics, no rhythm, no sadness or tension, clearly quieter than an active state.
```

### Calibration Bed

```text
Create a 30-second instrumental background for eyes-open and eyes-closed calibration instructions. Quiet forest bath ambience, slow neutral pulse, no vocals, no lyrics, no distracting melody, leaves room for spoken prompts, stable volume, no sudden transitions.
```

## Selection Rubric

Keep candidates that:

- Loop cleanly with no obvious cut, pickup, count-in, or end flourish.
- Stay quiet and low-distraction under Feedback Lab visuals.
- Preserve room for Cartesia or browser speech prompts.
- Sound distinct enough across Calm, Focus, Clarity, and Paused states without becoming theatrical.
- Avoid clinical, therapeutic, or diagnostic language in title/metadata.

Reject candidates that include:

- Vocals, lyrics, spoken words, strong drums, sharp transients, or sudden scene changes.
- Dramatic emotional swells, cinematic tension, sadness cues, or alarm-like tones.
- Recognizable imitation of a known artist, song, genre signature, or commercial sound.
- Audio that masks calibration cue speech or makes the operator console feel like a consumer wellness claim.

## Bundled Demo Loops

The currently bundled Lyria loops live under `frontend/src/assets/audio/feedback/`:

- `calm-trend.mp3`
- `focus-tone.mp3`
- `signal-clarity.mp3`
- `confidence-gate-open.mp3`
- `paused-low-confidence.mp3`
- `calibration-bed.mp3`

These loops are optional Feedback Lab sound choices. They do not replace the Web Audio pad fallback.

## Review Workflow

1. Generate 3 candidates for each prompt in Gemini/Lyria.
2. Save new candidates outside the repo first, for example under `~/Music/nexus-audio-candidates/`.
3. Rename candidates with stable local names such as `calm-trend-v2.mp3`, `focus-tone-v2.mp3`, and `paused-low-confidence-v2.mp3`.
4. Listen on headphones and laptop speakers at low volume.
5. Play each candidate under these contexts: Calm, Focus, Clarity, Paused, and calibration speech overlay.
6. Keep notes for loop quality, speech masking, emotional tone, and whether the clip should remain background-only.

## App Integration Notes

- Keep the existing Web Audio pad as the default fallback.
- Store selected assets under `frontend/src/assets/audio/feedback/` and expose them as optional loop voices in Feedback Lab.
- Imported loops must remain confidence-gated: silent while signal is paused/noisy and audible only after the existing feedback confidence threshold opens.
- Preserve explicit mute, volume, and local-only behavior. Do not upload EEG, recordings, or generated audio to a third-party service from the app.
