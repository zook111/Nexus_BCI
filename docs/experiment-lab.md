# Experiment Lab

Nexus BCI is a local EEG workspace for education and research.

A local school-research module for collecting labelled EEG trials and comparing tasks with a pyRiemann classifier. Task labels mean **what the participant was instructed to do**, not verified thoughts, focus, relaxation or clinical states.

## Run it

Install the backend dependencies into the existing environment (Python 3.12+):

```bash
.venv/bin/python -m pip install -e 'backend[dev]'
```

Use the normal Nexus launcher and choose **Experiment Lab**. No API key, cloud inference, GPU or paid service is needed. The frontend still uses the repository's supported Node version. Intel Mac installation and wearer-specific classification still require validation; development verification uses a local Mac and synthetic data.

## Collect and label

1. In **Console**, connect the board and start streaming. Check fresh samples, electrode contact and the existing signal-quality diagnostics. Save any existing recording before starting a lab session.
2. In **Experiment Lab**, enter a participant code (for example `P01`) and a descriptive recording name such as `Day 1 training`. Select **Eyes open / closed**, **Left / right hand imagery**, or two to four **Custom tasks**.
3. Select electrodes: the eye preset suggests O1/O2 and hand imagery suggests C3/C4. If those names are unavailable (for example on the synthetic board), the initial selection falls back to two available channels; review it explicitly. Keep electrode locations, reference and channel order consistent between training and testing.
4. **Start labelled recording** creates a new ordinary Nexus CSV and a separate experiment annotation file. Trial capture requires three fresh good-quality checks, spaced at least one second apart, for every selected electrode.
5. **Record next trial** randomly selects among the labels with the fewest completed included trials. A three-second preparation cue is followed by a six-, eight- or ten-second trial. Optional browser speech announces the task and completion. The operator clicks each trial, allowing breaks between trials. For self-recording, stop touching the computer during the preparation interval.
6. Rest between trials. Aim initially for 20 trials per task, spread across comfortable blocks. Collect fresh test data separately, preferably on another day. Keep eyes open for both hand-imagery tasks and imagine the feeling of moving the prompted hand without actually moving it.
7. **Save recording** stops this session. Interrupted/poor-signal trials are excluded. If a request is interrupted, refresh and use **Exclude interrupted trial**, or save the recording; incomplete trials never enter training.
8. In **Review labels**, correct a task label, uncheck an unwanted trial, and save an explanatory note. Exclusions do not delete raw EEG. Export annotation JSON and raw EEG CSV for the project record.

Switching views or hiding the browser tab cancels the current guided trial. The raw recording continues until saved. A browser refresh leaves an incomplete trial available to exclude. A backend restart marks an active experiment interrupted; complete raw data and labels remain on disk, but interrupted recordings are not offered for training. Starting Experiment Lab stops an existing Console calibration cue sequence.

## Train and evaluate

Select distinct saved **Training recording** and **Test recording** sessions, then press **Train pyRiemann & evaluate**. They must use the same participant code, board, sample rate, electrode list/order and task-label set. Identical raw files are rejected even if they have different session IDs. At least five accepted training trials and two accepted test trials per class are required; these are operating minimums, not a claim of statistical adequacy.

The fixed pipeline is:

- Independently filter each trial with a fourth-order 8–30 Hz Butterworth zero-phase bandpass.
- Discard the first second after the software marker; use the next three seconds, one epoch per trial.
- Estimate OAS-shrinkage covariance with `pyriemann.estimation.Covariances`.
- Fit `pyriemann.tangentspace.TangentSpace(metric="riemann")` on training epochs only.
- Fit scikit-learn `LogisticRegression(C=1, max_iter=2000, random_state=0)` on training features only.
- Transform and predict the separate test recording, without fitting anything to its samples or labels.

The report shows accuracy, balanced accuracy (mean per-class recall), balanced-chance level `1 / number_of_classes`, class counts, a confusion matrix, per-trial probabilities and all rejected-trial reasons. Classifier probabilities are **not calibrated confidence**. Synthetic-board results are explicitly marked as rehearsal, not brain decoding.

Reports are immutable snapshots containing CSV SHA-256 hashes, annotation snapshots, method parameters and package versions. Each evaluation refits the model; no executable model serialization is loaded. This first module evaluates saved trials: it does not deploy a persistent model for continuous live prediction.

Do not repeatedly tune an experiment against its final test data. If you use a test recording to choose labels, channels, features or exclusions based on performance, treat it as development data and collect another untouched test session.

## Quality and timing limits

Live readiness uses the existing acquisition-quality diagnostics at 50 Hz mains frequency. During capture, a failed check permanently excludes that trial. Offline extraction additionally rejects nonfinite samples, missing edges, gaps greater than three sample periods, short trials, flatlines, railing, high filtered RMS and excessive line noise using the same channel-quality implementation as Console. Interrupted trials cannot be manually forced back in.

These checks do not establish absence of eye/muscle artefacts. Review movement, cue following and consistency independently. A cue appears before capture and the classifier discards a further second, but browser and API latency mean markers are not hardware-synchronised stimulus onset measurements. This protocol is intended for sustained tasks, not short-latency evoked-potential experiments.

Limits: 300 trials per recording, 128 MB per CSV, 2–16 selected channels, 2–4 labels, sampling rate above 100 Hz. Computation uses one numerical worker thread. With very few test trials, accuracy has substantial sampling uncertainty. A successful software rehearsal does not establish wearer-specific motor-imagery accuracy.

## Files and API

Ordinary CSV and recording metadata stay in the configured, git-ignored recording directory. Lab annotations live at `recordings/experiments/<session_id>.json`; reports at `recordings/experiments/reports/<report_id>.json`. A different `MINDMELD_RECORDING_DIR` keeps the same layout. Back up CSV, metadata and annotations together. Deleting a recording in Console does not automatically delete the lab annotation or historical reports; an evaluation fails if its source CSV is missing.

The API is under `/api/experiments`: create/list/get sessions; poll `/{id}/readiness`; start `/{id}/trials`; finish `/{id}/trials/{trial_id}/finish`; edit trial labels/notes/inclusion; stop `/{id}/stop`; `POST /evaluate`; and `GET /reports`. Start requests carry a unique trial ID so a retry cannot create duplicate labels. All trials are keyed to an exact recording and board timestamps.


## Learn the maths

Choose **How the classifier works** in Experiment Lab to open an interactive lesson aimed at A-level maths students. It works without a headset. Save an active experiment before opening it so learning controls cannot distract from a labelled trial.

The five chapters cover filtering and frequency; means, variance and covariance; a logarithm-based introduction to Riemannian tangent coordinates; logistic regression and its sigmoid; and a short knowledge check about scaling, data leakage and probability interpretation. A four-pair worked example can be checked by hand. Matrices, eigenvalues, shrinkage and log loss are optional extension material.

All examples are synthetic and local. Linked sliders carry the same two-channel covariance through to the tangent features and prediction. The lesson labels its simplifications: analytic sine-component removal rather than a Butterworth filter; fixed 10% shrinkage rather than fitted OAS; reference `R = 100 I` rather than a training-derived mean; and hand-set binary weights rather than a fitted classifier. Its two-channel Riemannian transform is numerically checked against pyRiemann 0.9. It does not read recordings, train models, or modify capture/classifier settings.
