import { BookOpen, Download, ExternalLink } from 'lucide-react'
import setupGuideUrl from '../../docs/intel-ventura-setup.pdf?url'
import experimentGuideUrl from '../../docs/eyes-open-closed-experiment-guide.pdf?url'
import hardwareGuideUrl from '../../docs/hardware-session-packet.pdf?url'
import researchGuideUrl from '../../docs/student-starter-guide.pdf?url'
import './StudentHelp.css'

const guides = [
  { title: 'Set up your Intel MacBook', format: '2-page PDF', href: setupGuideUrl,
    description: 'Install on macOS Ventura, open the app and save your first simulated recording.',
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
        <li>Follow the setup PDF for your Intel MacBook on Ventura. The desktop launcher is called <strong>Nexus Server</strong>; it opens <strong>Dr K’s EEG Lab</strong>.</li>
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
    <div className="panel student-help__troubleshooting">
      <h3>If you get stuck</h3>
      <details><summary>The page will not open or says API disconnected</summary>
        <p>Double-click Nexus Server once, wait for startup, then open <a href="http://localhost:5173">http://localhost:5173</a>. Do not open frontend/index.html directly. If the launcher reports that services are already running, reload the browser. Opening the launcher again stops them.</p>
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
        <p>Save your work first. Note the exact message, board type and whether Synthetic works. From Terminal in the nexus folder, run <code>./script/build_and_run.sh --status</code>, <code>--verify</code> or <code>--logs</code>. These report service state and diagnostics. Share only the relevant error after checking for names, private paths or credentials; keep participant recordings and exports out of public issues.</p>
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
