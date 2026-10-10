import { BookOpen, Download, ExternalLink } from 'lucide-react'
import setupGuideUrl from '../../docs/intel-ventura-setup.pdf?url'
import experimentGuideUrl from '../../docs/eyes-open-closed-experiment-guide.pdf?url'
import researchGuideUrl from '../../docs/student-starter-guide.pdf?url'
import './StudentHelp.css'

const guides = [
  { title: 'Set up your Intel MacBook', format: '2-page PDF', href: setupGuideUrl,
    description: 'Install on macOS Ventura, open Nexus and save your first simulated recording.',
    link: 'Open setup guide' },
  { title: 'Run your first experiment', format: '3-page PDF', href: experimentGuideUrl,
    description: 'Collect eyes-open and eyes-closed trials, check labels, and keep training and test recordings separate.',
    link: 'Open experiment guide' },
  { title: 'Plan your first week', format: '2-page PDF', href: researchGuideUrl,
    description: 'Start with EEG and BCI reading links and a first-week plan for a two-student team.',
    link: 'Open research guide' },
]

export function StudentHelp() {
  return <section className="student-help" aria-labelledby="student-help-title">
    <header className="student-help__heading">
      <BookOpen size={24} aria-hidden="true" />
      <div><h2 id="student-help-title">Help and student guides</h2>
        <p>Start with setup, then work through your first experiment together.</p></div>
    </header>
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
      <p><strong>Reading during a session?</strong> Finish and save your experiment before switching views or opening a guide. Leaving a guided trial interrupts and excludes it; raw recording continues until saved.</p>
      <p>The PDFs are included with Nexus and open in a new tab. You can read them offline or save a copy to share.</p>
      <a href="https://github.com/zook111/Nexus_BCI#readme" target="_blank" rel="noopener noreferrer">
        Full README and troubleshooting (online, opens in a new tab) <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  </section>
}
