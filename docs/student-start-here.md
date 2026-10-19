# Start here: your EEG school project

This is the starting page for a two-student team using a 2017 Intel MacBook on macOS Ventura. The app is **Dr K's EEG Lab**. Its repository is **Nexus_BCI**, and its desktop launcher is **Nexus Server**. These names refer to the same project.

Keep this page bookmarked. You can also open these four PDFs from **Help** inside the app, including when the installed app is running without internet access. Research websites and software downloads need internet access.

## 1. Install and practise without the headset

Follow the [Intel/Ventura setup PDF](intel-ventura-setup.pdf), or use the [copyable setup instructions](intel-ventura-setup.md). One person types while the other checks the instructions. Use the standard Python 3.13 installer and Node 24 specified there; you do not need Homebrew, an API key or a GPU.

**New to coding?** Terminal is the Mac app where you enter the setup commands. Open it with **Command + Space**, type **Terminal**, then press **Return**. The setup guide's [Terminal introduction](intel-ventura-setup.md#4-meet-terminal-and-check-git) explains where to paste commands, what the prompt means and when to wait. You do not need to know how to code.

Finish the practice steps before moving on:

- Double-click Nexus Server. The browser opens the app at [http://localhost:5173](http://localhost:5173).
- To keep a shortcut in the Mac **Dock**, drag **Nexus Server** from the Desktop onto the app side of the Dock. The launcher opens the workspace in your browser; the browser window keeps its browser icon.
- In Console, choose **Synthetic → Connect → Start**. Changing waveforms show that simulated samples are arriving.
- Record a short practice session, capture setup, save it and reopen it with **Preview**. You should see saved samples and be able to move through the recording.
- Stop and Reset the board when finished. Double-click Nexus Server again to stop the services. Closing the browser alone does not stop them.

Synthetic data is for learning the controls. It cannot establish that a person's brain states can be classified. Installation on this exact Intel MacBook and collection of usable physical EEG still need practical verification.

## 2. Plan the project together

Read the [research links and first-week plan PDF](student-starter-guide.pdf). Agree a small question with your teacher, such as whether eyes-open and eyes-closed trials can be distinguished for one participant.

Decide the task instructions, rest periods, participant codes, exclusion rules and which recordings will be held back for testing before collecting data. Ask your teacher about permission to collect and store participant data. Swap operator and participant roles with breaks.

## 3. Check the headset before collecting trials

Use the [hardware session checklist PDF](hardware-session-packet.pdf), or its [copyable text version](hardware-session-packet.md). It covers the dongle, two ear clips, electrode contacts, fresh samples, signal quality and saving/reopening data. The last PDF page is a printable blank record sheet.

For a typed record, copy the [blank session sheet](hardware-session-record-sheet.md) into the ignored data folder. Open Terminal as described above. Enter the first line to open the project folder, then enter the other lines one at a time:

```bash
cd ~/Documents/nexus
mkdir -p data/session-notes
cp docs/hardware-session-record-sheet.md data/session-notes/P01-session-01.md
```

Open that local copy in a text editor and fill it in. Use a new filename for each session so you do not overwrite your notes. Keep completed sheets and participant data private.

Do not proceed until source timestamps advance and at least three consecutive signal-quality windows are usable. Keep the UK mains frequency at 50 Hz. The checklist explains where to check these and how to record a failed check.

## 4. Run the first experiment

Follow the [eyes-open vs eyes-closed experiment PDF](eyes-open-closed-experiment-guide.pdf). Use the hardware checklist alongside it for physical setup and saving checks.

Create a training recording and a separate, untouched test recording for each participant. Check labels and exclusions before fitting the classifier. Do not select settings by repeatedly looking at the test score. The [Experiment Lab method and limitations](experiment-lab.md) explains the analysis and what to report, including weak or negative results.

Before packing away, save recordings and labels, reopen the saved recordings, and follow the checklist's backup steps. Keep raw EEG, exports and completed participant sheets out of GitHub. A PDF downloaded from the repository is shareable; a participant's recording is private project data.

## If you get stuck

Try the matching step below. The installed app's **Help** tab also contains troubleshooting that works offline.

| What you see | What to do |
| --- | --- |
| `command not found` during setup | Open a new Terminal after installing Python and Node. Check the three version commands in the setup guide. If one is still missing, repeat that standard installer step. |
| `nexus` folder already exists | Keep it. Check that it is this project, then follow the setup guide's existing-folder instructions. Do not delete a folder containing recordings. |
| Page will not load or API disconnected | If services are stopped, start Nexus Server once and allow startup time. If they are already running, reload the browser. Use `http://localhost:5173` by default, or your configured frontend port, rather than opening `frontend/index.html`. Opening the launcher again stops running services. |
| Port 8000 or 5173 is occupied | Ask your helper to identify and stop the other application. Do not force-quit an unfamiliar process. |
| No recommended USB port | Check the dongle and USB-C adapter, then Refresh. Synthetic lets you test the software without a headset. |
| `BOARD_NOT_READY_ERROR:7` | Check headset power and PC mode. Close other acquisition apps, Reset, wait about five seconds, then Connect and Start. |
| Samples stop changing | Pause the experiment. Reset, wait for the port to settle, then Connect and Start. Check advancing timestamps before interpreting quality or collecting trials. |
| Noisy or flat channels | Work through the hardware checklist with your helper. Check reference/bias and channel contacts, keep leads away from power supplies and run the Mac on battery. Filtering does not repair a disconnected contact. |
| No spoken cue | Follow the visible instruction. Check volume and browser sound permissions. Speech support varies; setup works without a paid speech key. |
| Feedback audio is silent | It starts muted. Unmute only when ready; live feedback needs fresh, usable signal and enough confidence. Calm mode also needs a completed baseline. |

If you still need help, save your work and note the exact message, board type and whether Synthetic works. Open Terminal. Enter the first line to open the project folder, then run the diagnostic commands one at a time:

```bash
cd ~/Documents/nexus
./script/build_and_run.sh --status
./script/build_and_run.sh --verify
./script/build_and_run.sh --logs
```

These report service state and diagnostics. `--verify` checks local services; it does not certify electrode contact or EEG quality. Share the relevant error with your helper after checking for names, private paths or credentials. Do not attach raw EEG to a public issue.

For more detail, see the [README troubleshooting table](../README.md#if-something-is-not-working). There is no standalone DMG installer yet; the supported student route is the setup guide and desktop launcher.
