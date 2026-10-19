# Run your first physical EEG session

Nexus EEG Lab | Two-student team | Prepared 17 October 2026

**Goal:** install on the intended Intel MacBook, collect two separate labelled recordings, and reopen the saved data. A successful session produces usable recordings before any classifier claim.

This packet is **prepared**, not a completed hardware test. Software checks and a synthetic rehearsal do not establish physical signal quality. Use the [printable packet](hardware-session-packet.pdf) and copy the [blank record sheet](hardware-session-record-sheet.md) into an ignored local folder before filling it in.

## 1. Check the intended Mac and practise without a wearer

- [ ] Confirm the machine is the 2017 Intel MacBook on Ventura. Record the actual model, macOS version, and installed app commit.
- [ ] Follow the [Intel installation guide](intel-ventura-setup.md). Use macOS 13.5 or later, standard Python 3.13, Node 24, and Git. The existing pinned installer links remain in that guide.
- [ ] In Terminal, record `uname -m`, `sw_vers -productVersion`, `python3.13 --version`, `node --version`, and `git rev-parse HEAD` from the checkout. Expect `x86_64` on this Intel Mac.
- [ ] Use `NEXUS_PYTHON=python3.13 ./script/setup.sh` and `./script/install_desktop_launcher.sh` in a fresh checkout. Do not copy another Mac's `.venv` or `node_modules`.
- [ ] Open **Nexus Server** once. Confirm **Nexus EEG Lab** opens at [localhost:5173](http://localhost:5173) and shows **API connected**.
- [ ] In **Console**, select **Synthetic**, then **Connect** and **Start**. Record 30 seconds as `synthetic-practice`. Use **Capture setup**, then **Save**. Open **Preview** under **Telemetry**.
- [ ] Confirm the practice recording reopens with samples and timestamps. Mark only the intended-machine software rehearsal as passed.
- [ ] Press **Stop**, then **Reset**, before switching to the physical board.

Use one browser window as the operator console. If another window shows inconsistent controls, reload that window and inspect the backend state before reconnecting. The cross-window fix is tracked in [PR #8](https://github.com/zook111/Nexus_BCI/pull/8); do not assume an unmerged PR is installed.

The independent Intel installation remains **not verified** until these steps are executed on that Mac. Record the date, versions, outcome, and any exact error. Arrange school permission before involving a participant.

<!-- pagebreak -->

## 2. Fit the physical headset and common contacts

Assign one participant and one operator. Use a code such as `P01`. The operator handles the computer and notes; the participant stays seated and can stop at any time.

- [ ] Confirm the board from its label: **Cyton** has 8 channels; **Cyton Daisy** has 16. Select the matching board in Console. Do not infer the model from the dongle alone.
- [ ] Use the manufacturer's battery-powered setup and electrical-safety instructions. Keep the headset battery disconnected from its charger while worn. For a low-noise check, run the Mac on battery too.
- [ ] Insert the USB dongle, using a USB-C adapter if required. Follow the [Cyton guide](https://docs.openbci.com/GettingStarted/Boards/CytonGS/): dongle switch at **GPIO 6**, board switch at **PC**.
- [ ] Fit the headset comfortably. Confirm the actual wired electrode positions against the channel labels in the app, particularly posterior **O1** and **O2** for this protocol.
- [ ] Fit the two ear clips against bare earlobe skin, clear of hair and earrings. Leave slack so the leads do not pull the clips loose.
- [ ] Identify the leads by the board labels, not wire colour. For the [Ultracortex Mark IV Cyton arrangement](https://docs.openbci.com/AddOns/Headwear/MarkIV/#cyton-board-setup), reference uses **SRB2**, the lower SRB pin closest to the circuit board. Bias uses **BIAS**. Confirm connections against the actual model's guide.
- [ ] If a Daisy board is present, inspect its shared reference wiring using the [Daisy guide](https://docs.openbci.com/GettingStarted/Boards/DaisyGS/). Do not improvise a reference connection.
- [ ] Check that cables and inline connectors are seated. Keep leads away from chargers and mains power supplies.

**Before moving board connectors, stop acquisition and switch the headset off.** Preserve the known wiring and recheck the manufacturer's diagram. On Mark IV, disconnect an electrode mount's cable before twisting that mount, to avoid breaking its wire.

In Console, select the recommended `/dev/cu.usbserial-...` port, then **Connect** and **Start**. Expect 8 channels at 250 Hz for Cyton or 16 at 125 Hz for Cyton Daisy. These are expected transport settings, not a signal-quality pass.

<!-- pagebreak -->

## 3. Prove that samples are fresh and the signal is usable

Record observations on the local sheet. **STREAMING** alone does not prove that samples are advancing or that electrodes have useful contact.

1. Confirm the expected board, port, rate, and channel count in Console. Check physical positions, not only displayed names.
2. Open the read-only [live source summary](http://127.0.0.1:8000/api/demo/calm?line_frequency_hz=50). Record `source_timestamp`. Wait at least two seconds, reload the summary, and confirm a larger timestamp. Return to Console. Do this before starting any labelled trial.
3. Keep UK mains frequency at **50 Hz**, with the normal **1-45 Hz** live bandpass and notch enabled. Keep the same mains setting in training and test. The classifier has its own fixed 8-30 Hz processing.
4. Inspect each selected channel's quality. The read-only [channel quality summary](http://127.0.0.1:8000/api/signal/quality?window_size=500&line_frequency_hz=50) includes `filtered_rms`, `line_noise_ratio`, `status`, and `issues`. Log values for O1 and O2, or your pre-agreed channels.
5. Observe at least three consecutive fresh usable windows before calibration. In Experiment Lab, require **3/3 clean windows** and an enabled **Record next trial** for every selected electrode. Readiness checks advance at least one second apart. Repeated reads of one buffer do not count.

**Stop and correct acquisition when a check fails.** Do not lower thresholds or interpret classifier scores to compensate.

| Observation | Next action |
| --- | --- |
| Timestamp does not advance | Reset and reconnect after the serial port settles. Recheck freshness. |
| Most channels show mains interference | Check shared reference and bias contact, cable routing, and power supplies first. |
| Flatline with railing near +/-187,500 uV | Check contact and connector seating. If widespread, start with the common contacts. |
| Only one channel remains poor | Refit that electrode and its cable. Recheck several windows. |
| `BOARD_NOT_READY_ERROR:7` | Check power, PC mode, and radio lights. Release the port, wait about five seconds, and make one clean connection attempt. |

Current diagnostics flag line-noise ratio at 0.25 or above and filtered EEG-band RMS at 150 uV or above. The line-noise metric measures raw acquisition power, so a flag can remain despite an enabled notch. One clean window is insufficient. Save failures as observations; they are a valid outcome for this session.

<!-- pagebreak -->

## 4. Collect training, then a genuinely separate test recording

Agree the method before collection: same participant, board, electrode list and order, mains setting, lighting, posture, **8-second trials**, and **5-10 seconds of rest**. Aim for 20 accepted trials per task in each recording. Take breaks and stop if uncomfortable.

1. Save any previous Console recording. Open **Experiment Lab**. Enter participant `P01`, name `P01-training-01`, and task preset **Eyes open / closed**. Explicitly select the agreed electrodes, normally O1 and O2. Never accept fallback channels without checking their physical positions.
2. Click **Start labelled recording**. Set **Trial length** to **8 seconds**. Choose **Speak cue** if wanted, and keep this choice for the test. Wait for **3/3 clean windows**.
3. Click **Record next trial**. The app chooses a balanced task label and provides three seconds to prepare. With eyes open, look softly at one plain spot. With eyes closed, close gently without squeezing. Stay still and relax the jaw until the trial finishes.
4. The operator observes the whole trial and notes mistakes. Between trials, reopen the eyes and rest. Keep the Experiment Lab tab visible throughout each trial. Hiding the tab or changing views interrupts the trial.
5. If a trial goes wrong, use **Stop & exclude trial**. After an interrupted refresh, use **Exclude interrupted trial**. Do not force automated quality failures back into the dataset.
6. After the final trial finishes, click the Lab's **Save recording**. In **Review labels**, inspect every trial before looking at scores. Save notes with **Save note**. Correct a label only when the operator observed the other state for the entire trial. Exclude mixed or uncertain states, missed cues, movement, or interrupted trials under the pre-agreed rules.
7. Record the training session ID and included counts. Fix the channel choices, method, and exclusion rules before collecting the test. Take a break; a later day provides a stronger test of repeatability.
8. Create **a new labelled recording** named `P01-test-01`. Use the same `P01`, board, sample rate, electrode list and order, labels, mains setting, and trial/rest settings. Repeat steps 2-6 with fresh samples.

Never copy or rename training data to make a test set. Do not split adjacent windows from one recording or reuse trials across the pair. If roles switch, use `P02` and collect a separate training/test pair. Review test quality and labels before predictions, using the same rules as training.

<!-- pagebreak -->

## 5. Save, replay, and preserve the evidence

Complete this check for **both** training and test before evaluating a classifier.

- [ ] Confirm the Lab session is saved, with its own ID, name, and participant code. Record included and excluded counts for each label and the reasons.
- [ ] Use **Export labels** and **Download raw EEG CSV**. Match each export to its session ID. The annotation file contains task labels, sample timing, inclusion decisions, and notes; CSV alone is insufficient.
- [ ] In **Experiment Lab > Review labels**, select the saved session. Check the displayed channel list, sample rate, mains frequency, and board against the session sheet. Repeat for the other recording.
- [ ] In **Console > Telemetry**, find the same saved session and click **Preview**. Confirm the app identifies replay, shows the expected channels, and contains samples. The replay header does not display sample rate; use the saved metadata check above for that evidence.
- [ ] Move through the beginning, middle, and end using the replay controls. Check that positions change and that the recording is not empty, constant, or unexpectedly cut short. Replay is saved data, not a new live-quality measurement.
- [ ] Check the second session separately. Confirm the two CSVs contain different time ranges. Retain complete app recording metadata and experiment annotations with both CSVs.
- [ ] After saving everything, press **Stop** and **Reset** in Console. Double-click **Nexus Server** again to stop the local services. Open it later and confirm each saved session still appears and opens. Record that persistence check separately from the immediate preview.

### Keep participant files local

Copy the blank sheet into ignored local storage before adding real observations:

```bash
mkdir -p data/session-notes
cp docs/hardware-session-record-sheet.md data/session-notes/P01-session-01.md
```

Keep raw CSVs, recording metadata, and `recordings/experiments/` together when backing up the app's recording folder. Custom `MINDMELD_RECORDING_DIR` storage follows the same layout. Keep exports under ignored `exports/`, and identify files by participant code and session ID. Store any name-to-code key separately under the school's agreed access rules.

An ignored folder is not encryption or consent. Use agreed private storage and sharing arrangements. Do not commit filled sheets, raw signals, identifiable screenshots, labels, or reports. Do not paste them into public issues, PRs, or chat tools. A public project summary can describe the method and approved aggregate results without publishing participant data.

### Evaluate only after acquisition passes

Select distinct saved **Training recording** and **Test recording** sessions, then **Train pyRiemann & evaluate**. Record balanced accuracy, per-class counts, confusion matrix, rejection reasons, and the report ID. Use **Export result & method** to preserve hashes and method details. Five training and two test trials per label are software minimums, not adequate-study guarantees. A two-class balanced-chance reference is 50%; a small score above it does not prove reliable EEG classification. After tuning against a test, collect a fresh untouched test recording.

<!-- pagebreak -->

## 6. Record the session outcome

Leave an unexecuted item **NOT RUN**. Use **PASS** only with recorded evidence, or **FAIL** with the observed error and next action. Use the copyable record sheet for full channel values and file paths.

| Session details | Write here |
| --- | --- |
| Date, operator code, participant code | ______________________________ |
| Mac model, macOS, architecture | ______________________________ |
| App commit, Python, Node | ______________________________ |
| Board, rate, channel list/order | ______________________________ |
| Reference, bias, electrode fit checked | ______________________________ |
| Trial length, rest, lighting, mains | ______________________________ |

| Check | Status and evidence |
| --- | --- |
| Independent Intel install and synthetic save/replay | ______________________________ |
| Physical source timestamps increase | __________ to __________ |
| Three fresh clean windows, selected channels | 1 ________ 2 ________ 3 ________ |
| Training session ID; open/closed included counts | ______________________________ |
| Test session ID; open/closed included counts | ______________________________ |
| Excluded trials and reasons | ______________________________ |
| Both exports and matching metadata retained | ______________________________ |
| Preview: start, middle, end for both sessions | ______________________________ |
| Reopen after restart: both sessions persist | ______________________________ |
| Classifier report ID, or NOT RUN with reason | ______________________________ |
| Balanced accuracy, counts, limitations | ______________________________ |

**Session outcome:** usable independent recording pair / acquisition needs work / software setup incomplete. Circle one and state what happened:

____________________________________________________________________

____________________________________________________________________

**Next physical action or correction:** __________________________________

Sources and companion guides: [Intel setup](https://github.com/zook111/Nexus_BCI/blob/main/docs/intel-ventura-setup.md), [eye-state experiment PDF](https://github.com/zook111/Nexus_BCI/blob/main/docs/eyes-open-closed-experiment-guide.pdf), [Experiment Lab method](https://github.com/zook111/Nexus_BCI/blob/main/docs/experiment-lab.md), [OpenBCI Cyton](https://docs.openbci.com/GettingStarted/Boards/CytonGS/), [Mark IV wiring](https://docs.openbci.com/AddOns/Headwear/MarkIV/), [Daisy wiring](https://docs.openbci.com/GettingStarted/Boards/DaisyGS/), [Node 24 macOS targets](https://github.com/nodejs/node/blob/v24.21.0/BUILDING.md#platform-list), and [Python 3.13 installer](https://www.python.org/downloads/release/python-31316/). External guidance inspected 17 October 2026. This packet does not replace the manufacturer's setup or safety instructions.
