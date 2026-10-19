import { BookOpen, Download, ExternalLink } from 'lucide-react'
import setupGuideUrl from '../../docs/intel-ventura-setup.pdf?url'
import experimentGuideUrl from '../../docs/eyes-open-closed-experiment-guide.pdf?url'
import hardwareGuideUrl from '../../docs/hardware-session-packet.pdf?url'
import researchGuideUrl from '../../docs/student-starter-guide.pdf?url'
import './StudentHelp.css'

const guides = [
  { title: 'Set up your Intel MacBook', format: '3-page PDF', href: setupGuideUrl,
    description: 'Start with what Terminal is and how to open it, install on macOS Ventura, then save your first simulated recording.',
    link: 'Open setup guide' },
  { title: 'Run your first experiment', format: '3-page PDF', href: experimentGuideUrl,
    description: 'Collect eyes-open and eyes-closed trials, check labels, and keep training and test recordings separate.',
    link: 'Open experiment guide' },
  { title: 'Prepare the headset session', format: '6-page PDF', href: hardwareGuideUrl,
    description: 'Fit the headset, check fresh samples and contact quality, save and replay recordings, and complete the blank session sheet.',
    link: 'Open hardware checklist' },
  { title: 'Plan your first week', format: '2-page PDF', href: researchGuideUrl,
    description: 'Start with EEG and BCI reading links and a first-week plan for a two-student team.',
    link: 'Open research guide' },
]

export function StudentHelp() {
  return <section className="student-help" aria-labelledby="student-help-title">
    <header className="student-help__heading">
      <BookOpen size={24} aria-hidden="true" />
      <div><h2 id="student-help-title">Help and student guides</h2>
        <p>Work as a pair: one person operates the app while the other checks each step.</p></div>
    </header>
    <div className="panel student-help__start">
      <h3>Your first session</h3>
      <ol>
        <li>Follow the setup PDF for your Intel MacBook on Ventura. The desktop launcher is called <strong>Nexus Server</strong>; it opens <strong>Nexus EEG Lab</strong>.</li>
        <li>Practise in Console with <strong>Synthetic → Connect → Start</strong>. Save a short recording and reopen it with Preview. The signals are simulated.</li>
        <li>Before collecting participant data, agree your method with your teacher and work through the hardware checklist. Check fresh samples and at least three consecutive usable quality windows.</li>
        <li>Follow the experiment PDF. Use separate training and untouched test recordings for each participant.</li>
      </ol>
    </div>
    <div className="student-help__guides">
      {guides.map(guide => <article key={guide.title} className="panel student-help__guide">
        <span className="student-help__format">{guide.format}</span>
        <h3>{guide.title}</h3>
        <p>{guide.description}</p>
        <a href={guide.href} target="_blank" rel="noopener noreferrer"
          aria-label={`${guide.link} PDF (opens in a new tab)`}>
          <Download size={16} aria-hidden="true" />{guide.link} (PDF)
        </a>
      </article>)}
    </div>
    <div className="panel student-help__notes">
      <h3>Report a problem or ask a question</h3>
      <p>No Terminal or coding needed. Sign in to GitHub, check existing issues, then choose a form. Describe your steps, what you expected, what happened, and your Mac/browser. “Not sure” is fine for details you do not know. Bookmark your issue to check for replies.</p>
      <p>Issues are public. Keep names, faces, school/contact details, passwords, API keys, serial numbers, participant recordings and results private. Check screenshots for private tabs, notifications, paths and labels.</p>
      <p>For a security flaw or exposed credential, <a href="https://github.com/zook111/Nexus_BCI/security/advisories/new" target="_blank" rel="noopener noreferrer">report a security problem privately (online, opens in a new tab) <ExternalLink size={14} aria-hidden="true" /></a>. If that page is unavailable, or you need to discuss other private information, ask your parent or teacher to contact Karl privately. Do not post it in an issue.</p>
      <p><a href="https://github.com/zook111/Nexus_BCI/blob/main/docs/report-a-problem.md" target="_blank" rel="noopener noreferrer">Learn how to report an issue (online, opens in a new tab) <ExternalLink size={14} aria-hidden="true" /></a></p>
      <p><a href="https://github.com/zook111/Nexus_BCI/issues/new/choose" target="_blank" rel="noopener noreferrer">Report a problem or ask a question (online, opens in a new tab) <ExternalLink size={14} aria-hidden="true" /></a></p>
    </div>
    <div className="panel student-help__notes">
      <h3>Updates without Terminal</h3>
      <p>Finish and save your experiment and recording, then Stop and Reset the board. Double-click Nexus Server to stop its services, then open it again. Closing the browser alone does not stop them.</p>
      <p>When an update is offered, choose <strong>Update and restart</strong> or <strong>Not now</strong>. Installation needs internet and may take several minutes; the workspace opens when ready. Recordings and local settings stay in place. Offline checks still let your installed version open; no offer does not prove it is up to date.</p>
      <p>If recovery asks for help, keep the app stopped and ask your helper. Local code edits are preserved and block updates. Older installs need one helper-led source update and launcher reinstall first; fresh setup includes this.</p>
    </div>
    <div className="panel student-help__troubleshooting">
      <h3>If you get stuck</h3>
      <details><summary>The page will not open or says API disconnected</summary>
        <p>If services are stopped, double-click Nexus Server once and wait for startup. If they are already running, reload the browser or <a href="/">reopen this app</a>. The default address is http://localhost:5173; this link keeps your current port. Do not open frontend/index.html directly. Opening the launcher again stops running services.</p>
      </details>
      <details><summary>There is no headset port, or Connect fails</summary>
        <p>Check the USB dongle, USB-C adapter and headset power/PC mode. Close other acquisition apps. Refresh the port list; choose Cyton for 8 channels and the recommended /dev/cu.* USB port. For BOARD_NOT_READY_ERROR:7, Reset, wait about five seconds, then Connect and Start. Use Synthetic to check the software without the headset.</p>
      </details>
      <details><summary>Samples freeze or the channels are noisy</summary>
        <p>Do not collect trials from a frozen or poor-quality stream. For frozen samples, Reset, wait for the port to settle, then Connect and Start. For noise, use the hardware checklist to check reference/bias contacts and electrodes, keep leads away from power supplies and run the Mac on battery. Keep the UK mains setting at 50 Hz. Require fresh samples and three consecutive usable quality windows before continuing.</p>
      </details>
      <details><summary>There is no spoken cue or feedback sound</summary>
        <p>Use the visible task instruction to follow the trial. Check the Mac volume and browser sound permissions. Feedback audio starts muted and stays silent until the signal gate opens; Calm mode also needs a baseline. No API key is needed for setup or synthetic practice.</p>
      </details>
      <details><summary>I need help from my teacher or teammate</summary>
        <p>Save your work first. Note the exact message, board type and whether Synthetic works. Use the reporting links above; you do not need Terminal to submit an issue. If your helper asks for diagnostics, run <code>./script/build_and_run.sh --status</code>, <code>--verify</code> or <code>--logs</code> from Terminal in the nexus folder. Share only the relevant error after checking for names, private paths or credentials; keep participant recordings and exports out of public issues.</p>
      </details>
    </div>
    <div className="panel student-help__notes">
      <p><strong>Reading during a session?</strong> Finish and save your experiment before switching views or opening a guide. Leaving a guided trial interrupts and excludes it; raw recording continues until saved.</p>
      <p>All four PDFs are included with the app and open in a new tab. You can read them offline or save a copy to share. External research and manufacturer links need internet access.</p>
      <a href="https://github.com/zook111/Nexus_BCI#readme" target="_blank" rel="noopener noreferrer">
        Full README and troubleshooting (online, opens in a new tab) <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  </section>
}
