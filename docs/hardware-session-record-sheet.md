# Physical EEG session record

**Blank template. Copy into ignored `data/session-notes/` before filling it in. Do not commit completed sheets.**

Use `NOT RUN`, `PASS`, or `FAIL` for each stage. A pass requires the evidence requested below. Follow the [session packet](hardware-session-packet.md).

## Machine and method

| Field | Actual value |
| --- | --- |
| Date; operator code; participant code | |
| School permission and private-storage arrangement checked | |
| Machine model; architecture; macOS | |
| App commit; Python; Node; npm | |
| Independent intended-machine install outcome and exact error | NOT RUN |
| Synthetic practice session ID; save/preview outcome | NOT RUN |
| Actual board model; sample rate; channel count | |
| Physical electrode list and app channel order | |
| Reference and bias contact/wiring check | NOT RUN |
| UK mains 50 Hz; notch and live bandpass | |
| Trial length; rest; lighting; posture; speech setting | |
| Exclusion rules agreed before data collection | |

## Freshness and selected-channel quality

| Source check | Timestamp and observation |
| --- | --- |
| First live `source_timestamp` | |
| Second timestamp, at least two seconds later | |
| Freshness outcome and any reconnect/error | NOT RUN |

Record each selected channel separately in each window. Add rows for more channels. Do not fill these from replay.

| Window | Observation time | Source timestamp | Physical/channel label | Quality status | Filtered RMS uV | Line-noise ratio | Issues and action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 3 | | | | | | | |

Experiment Lab readiness before trials: NOT RUN. Observed `3/3 clean windows`: ______.

## Two separate recordings

| Field | Training | Untouched test |
| --- | --- | --- |
| Session name and ID | | |
| Participant code | | |
| Start/end time; CSV time range | | |
| Same board, rate, channels/order, labels, mains | | |
| Included eyes-open trials | | |
| Included eyes-closed trials | | |
| Excluded trials with reason, before predictions | | |
| Raw CSV, annotation JSON, app metadata paths | | |
| Saved state confirmed | NOT RUN | NOT RUN |
| Rate, board, mains, channels checked in Review labels | NOT RUN | NOT RUN |
| Preview start/middle/end | NOT RUN | NOT RUN |
| Reopened after launcher restart | NOT RUN | NOT RUN |

Use trial notes in the app for label corrections and exclusions. Do not remove trials because they lower a score. If roles switch, start a new participant code and a new pair.

## Backup and optional evaluation

| Field | Actual value |
| --- | --- |
| Private backup location; complete recordings folder copied | NOT RUN |
| Training/test CSV SHA-256 hashes from exported report, if evaluated | |
| Chosen training ID and different test ID | |
| Evaluation outcome; exact refusal/error if blocked | NOT RUN |
| Report ID; local report path; method/settings retained | |
| Balanced accuracy; ordinary accuracy; balanced-chance reference | |
| Per-class accepted training/test counts; confusion matrix | |
| Offline rejection reasons; artefact and sample-size limitations | |
| Test remained untouched by tuning; otherwise replacement test ID | |

## Handoff

- Software install: NOT RUN.
- Simulated rehearsal: NOT RUN.
- Usable physical acquisition: NOT RUN.
- Independent saved-data replay/persistence: NOT RUN.
- Classifier evaluation: NOT RUN.
- What failed, if anything:
- Next concrete action:
- Files retained privately:
- Data/retention access agreed with teacher:
