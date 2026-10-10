import { useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, BookOpen, Check } from 'lucide-react'
import { classify, covariance, shrink, sigmoid, tangentFeatures, teachingSignals, type Symmetric2 } from './maths'
import './ClassifierLesson.css'

const chapters = ['Filtered EEG', 'Covariance', 'Tangent-space features', 'Logistic regression', 'Test your understanding']
const fmt = (x: number, digits = 2) => (Math.abs(x) < 0.00001 ? 0 : x).toFixed(digits)
const sources = {
  tangent: 'https://pyriemann.readthedocs.io/en/v0.9/generated/pyriemann.tangentspace.TangentSpace.html',
  covariance: 'https://scikit-learn.org/stable/modules/covariance.html#shrunk-covariance',
  logistic: 'https://scikit-learn.org/stable/modules/linear_model.html#logistic-regression',
}

function Matrix({ entries, name }: { entries: Symmetric2; name: string }) {
  return <div className="lesson-matrix" role="group" aria-label={`${name}: row one ${fmt(entries[0])}, ${fmt(entries[1])}; row two ${fmt(entries[1])}, ${fmt(entries[2])}`}>
    <span aria-hidden="true">{name} =</span><div aria-hidden="true">{[entries[0], entries[1], entries[1], entries[2]].map((v, i) => <span key={i}>{fmt(v)}</span>)}</div>
  </div>
}
function Slider({ name, value, min, max, step, unit = '', onChange }: {
  name: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void
}) {
  return <label className="lesson-slider"><span>{name}<output>{fmt(value)}{unit}</output></span>
    <input type="range" aria-label={name} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
  </label>
}
function Waveform({ series, title, limit }: { series: { values: number[]; name: string; color: string }[]; title: string; limit: number }) {
  const w = 520, h = 200, left = 48, right = 15, top = 16, bottom = 40
  const x = (i: number, n: number) => left + i / (n - 1) * (w - left - right)
  const y = (v: number) => top + (limit - v) / (2 * limit) * (h - top - bottom)
  return <figure className="lesson-figure"><figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${title}. Horizontal axis time from 0 to 1 second; vertical axis amplitude in microvolts from minus ${limit} to ${limit}.`}>
      {[-limit, 0, limit].map(v => <g key={v}><line className="lesson-grid" x1={left} x2={w - right} y1={y(v)} y2={y(v)} /><text x={left - 7} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      <text x={left} y={h - 22}>0</text><text x={w - right} y={h - 22} textAnchor="end">1</text>
      <text x={w / 2} y={h - 5} textAnchor="middle">Time (s)</text><text x={left} y={12}>µV</text>
      {series.map((s, index) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="1.8" strokeDasharray={index === 1 ? '5 3' : undefined} points={s.values.map((v, i) => `${x(i, s.values.length)},${y(v)}`).join(' ')} />)}
    </svg>
    <div className="lesson-legend">{series.map((s, i) => <span key={s.name}><i style={{ background: s.color }} />{s.name}{i === 1 ? ' (dashed)' : ''}</span>)}</div>
  </figure>
}
function Scatter({ a, b, correlation }: { a: number[]; b: number[]; correlation: number }) {
  const coord = (v: number) => 150 + v * 2.5
  return <figure className="lesson-figure"><figcaption>Same-time pairs: one dot per sample</figcaption>
    <svg viewBox="0 0 320 320" role="img" aria-label={`Channel A versus channel B, both in microvolts. Correlation ${fmt(correlation)}. A positive correlation tilts the points upward; negative tilts downward.`}>
      {[-40, 0, 40].map(v => <g key={v}><line className="lesson-grid" x1={50} x2={250} y1={coord(-v)} y2={coord(-v)} /><text x={40} y={coord(-v) + 4} textAnchor="end">{v}</text><text x={coord(v)} y={270} textAnchor="middle">{v}</text></g>)}
      <line className="lesson-grid" x1={150} x2={150} y1={50} y2={250} />
      {a.map((v, i) => <circle key={i} cx={coord(v)} cy={coord(-b[i])} r={2.2} fill="var(--lesson-blue)" opacity={0.6} />)}
      <text x={150} y={292} textAnchor="middle">Channel A (µV)</text><text transform="translate(15 150) rotate(-90)" textAnchor="middle">Channel B (µV)</text>
    </svg>
  </figure>
}
function SigmoidPlot({ z, probability }: { z: number; probability: number }) {
  const limit = Math.max(8, Math.ceil(Math.abs(z)))
  const x = (v: number) => 45 + (v + limit) / (2 * limit) * 430
  const y = (v: number) => 180 - v * 155
  const points = Array.from({ length: 161 }, (_, i) => { const v = -limit + 2 * limit * i / 160; return `${x(v)},${y(sigmoid(v))}` })
  return <figure className="lesson-figure"><figcaption>A score becomes a probability</figcaption>
    <svg viewBox="0 0 510 225" role="img" aria-label={`Sigmoid graph. Score ${fmt(z)} corresponds to ${(probability * 100).toFixed(1)} percent probability of pattern B.`}>
      {[0, 0.5, 1].map(p => <g key={p}><line className="lesson-grid" x1={45} x2={475} y1={y(p)} y2={y(p)} /><text x={37} y={y(p) + 4} textAnchor="end">{p}</text></g>)}
      <line className="lesson-grid" x1={x(0)} x2={x(0)} y1={25} y2={180} />
      <polyline points={points.join(' ')} stroke="var(--lesson-blue)" fill="none" strokeWidth={3} />
      <circle cx={x(z)} cy={y(probability)} r={6} fill="var(--lesson-orange)" stroke="white" strokeWidth={2} />
      <text x={45} y={200}>−{limit}</text><text x={x(0)} y={200} textAnchor="middle">0</text><text x={475} y={200} textAnchor="end">{limit}</text><text x={260} y={220} textAnchor="middle">Weighted score z (dimensionless)</text>
    </svg>
  </figure>
}

const questions = [
  { prompt: 'Double both channel amplitudes. What happens to every covariance entry?', choices: ['Doubles', 'Multiplies by four', 'Stays the same'], answer: 1, why: 'Each entry averages a product of two centred amplitudes. Two factors of 2 give 4. Correlation stays the same.' },
  { prompt: 'Which data should set the reference matrix and classifier weights?', choices: ['Training recordings only', 'All recordings, including the final test', 'The highest-scoring test trials'], answer: 0, why: 'The reference and weights are fitted on training data. Keep the test recording untouched to estimate generalisation.' },
  { prompt: 'The classifier reports p = 0.9. What does that establish?', choices: ['The person is definitely imagining that task', 'The model assigned a high probability; its reliability still needs testing', 'The EEG is free of muscle artefacts'], answer: 1, why: 'A probability is a model output. Calibration, artefacts and performance on fresh recordings need independent checks.' },
]
function KnowledgeCheck() {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  return <div className="lesson-questions">{questions.map((q, i) => <fieldset key={q.prompt}><legend>{i + 1}. {q.prompt}</legend>
    {q.choices.map((choice, j) => <button key={choice} type="button" aria-pressed={answers[i] === j} onClick={() => setAnswers(previous => ({ ...previous, [i]: j }))}>{choice}</button>)}
    {answers[i] !== undefined && <p role="status"><strong>{answers[i] === q.answer ? 'Correct. ' : 'Try this reasoning: '}</strong>{q.why}</p>}
  </fieldset>)}</div>
}

export function ClassifierLesson({ onClose }: { onClose: () => void }) {
  const [chapter, setChapter] = useState(0)
  const [correlation, setCorrelation] = useState(0.6)
  const [amplitudeB, setAmplitudeB] = useState(10)
  const [mains, setMains] = useState(20)
  const [weight, setWeight] = useState(1.4)
  const [intercept, setIntercept] = useState(-0.2)
  const signals = teachingSignals(correlation, amplitudeB, mains)
  const sampleCovariance = covariance(signals.channelA, signals.channelB)
  const regularized = shrink(sampleCovariance)
  const features = tangentFeatures(regularized)
  const prediction = classify(features, weight, intercept)
  function reset() { setCorrelation(0.6); setAmplitudeB(10); setMains(20); setWeight(1.4); setIntercept(-0.2) }

  return <section className="classifier-lesson" aria-label="How the EEG classifier works">
    <header className="lesson-header"><div><span className="lesson-eyebrow"><BookOpen size={15} /> A-level maths lab</span><h2>From a wave to a prediction</h2><p>Follow one invented, two-channel trial through the four stages.</p></div><button type="button" onClick={onClose}><ArrowLeft size={16} />Back to experiment</button></header>
    <p className="lesson-disclaimer">Interactive teaching example · synthetic signals · no headset or recording needed. The numbers below are not your trained model.</p>
    <nav className="lesson-steps" aria-label="Lesson chapters">{chapters.map((title, i) => <button key={title} type="button" aria-current={chapter === i ? 'step' : undefined} onClick={() => setChapter(i)}><span>{i < 4 ? i + 1 : <Check size={16} />}</span>{title}</button>)}</nav>
    <div className="lesson-body">
      {chapter === 0 && <>
        <div className="lesson-intro"><span className="lesson-eyebrow">01 / Functions &amp; frequency</span><h3>Keep the rhythm we want to study</h3><p>An electrode records voltage over time, measured in microvolts (µV). At 250 Hz, the headset takes 250 samples every second. Our real classifier uses a 3-second segment: at this sampling rate, that is 750 numbers per channel.</p></div>
        <div className="lesson-two"><div><p>This teaching signal is a sum of three sine waves:</p><div className="lesson-equation">x(t) = 10√2 sin(2π·12t) + a sin(2π·50t) + 12 sin(2πt)</div><p>The 12 Hz component is inside our 8–30 Hz analysis band. The 1 Hz drift and 50 Hz mains component are outside it.</p><Slider name="50 Hz interference amplitude" value={mains} min={0} max={40} step={1} unit=" µV" onChange={setMains} /><p className="lesson-challenge"><strong>Try it:</strong> increase the interference. The raw trace changes; the retained 12 Hz wave does not.</p></div>
          <Waveform title="One second of channel A" limit={75} series={[{ values: signals.rawA, name: 'Raw teaching signal', color: 'var(--lesson-orange)' }, { values: signals.channelA, name: 'Retained 12 Hz component', color: 'var(--lesson-blue)' }]} /></div>
        <aside className="lesson-note"><strong>In Nexus:</strong> a fourth-order Butterworth 8–30 Hz bandpass is applied separately to each saved trial, forward and backward for zero phase shift. This picture removes known sine components exactly to explain the idea; a real filter attenuates frequencies gradually. Filtering cannot prove that a signal is brain activity: eye and muscle artefacts can overlap the retained band.</aside>
        <details><summary>Why 750 samples do not mean 750 independent training examples</summary><p>Nearby samples are related. We treat the whole 3-second trial segment as one example, with one task label. Splitting neighbouring samples between training and testing can make accuracy look much better than it really is.</p></details>
      </>}
      {chapter === 1 && <>
        <div className="lesson-intro"><span className="lesson-eyebrow">02 / Means, variance &amp; products</span><h3>Summarise how the channels vary together</h3><p>Subtract each channel’s mean, multiply the paired deviations, then average. Positive covariance means the deviations tend to have the same sign; negative covariance means they tend to have opposite signs.</p></div>
        <div className="lesson-two"><div><Slider name="Channel correlation" value={correlation} min={-0.9} max={0.9} step={0.1} onChange={setCorrelation} /><Slider name="Channel B standard deviation" value={amplitudeB} min={5} max={25} step={1} unit=" µV" onChange={setAmplitudeB} />
          <div className="lesson-equation">S₁₂ = (1/N) Σ (xᵢ − x̄)(yᵢ − ȳ)</div><p>Here N = 250. S₁₁ and S₂₂ are variances. S₁₂ = S₂₁, so two channels need only three different numbers. Entries have units of µV².</p><Matrix entries={sampleCovariance} name="S" /><p>Correlation = S₁₂ / √(S₁₁S₂₂) = <strong>{fmt(correlation)}</strong>. It has no units.</p><p className="lesson-challenge"><strong>Try it:</strong> reverse the correlation, then double B’s standard deviation. Its variance quadruples and the cross-covariance doubles; correlation is unchanged.</p></div><Scatter a={signals.channelA} b={signals.channelB} correlation={correlation} /></div>
        <details><summary>Worked example: four pairs you can calculate by hand</summary><p>Take x = [−2, −1, 1, 2] and y = [−1, −2, 2, 1]. Both means are zero. The products are [2, 2, 2, 2], so covariance is 8/4 = 2. Each variance is 10/4 = 2.5, giving correlation 2/2.5 = 0.8.</p><p>We use 1/N, as in the empirical covariance underlying this pipeline. You may have met the unbiased sample estimate using 1/(N−1); that is a different normalisation.</p></details>
        <aside className="lesson-note"><strong>Keep estimates stable:</strong> our next stage uses C = 0.9S + 0.1mI, where m is the mean diagonal entry and I has ones on its diagonal and zeros elsewhere. This gentle “shrinkage” reduces unstable estimates. In the app, OAS chooses the shrinkage amount from the data; the lesson fixes it at 10%.<Matrix entries={regularized} name="C" /></aside>
        <p>Covariance is not proof of a direct connection between brain areas. Shared reference signals, common sources and artefacts can also make channels vary together.</p>
      </>}
      {chapter === 2 && <>
        <div className="lesson-intro"><span className="lesson-eyebrow">03 / Logarithms, with a matrix extension</span><h3>Give each matrix a useful set of coordinates</h3><p>Covariance matrices are constrained: variance cannot be negative, and every non-zero weighted combination of channels must have positive variance for a positive-definite matrix. They are not arbitrary lists of numbers.</p></div>
        <div className="lesson-two"><div><h4>Start with one variance</h4><p>If the reference variance is 100 µV², twice as much gives ln(200/100) = ln 2 ≈ 0.693. Half as much gives ln(50/100) = −0.693. Logs express proportional changes on a balanced scale.</p><div className="lesson-equation">ln(variance / reference variance)</div><p>The ratio is dimensionless. A matrix logarithm extends this idea to the pattern across channels.</p><Slider name="Channel correlation" value={correlation} min={-0.9} max={0.9} step={0.1} onChange={setCorrelation} /><Slider name="Channel B standard deviation" value={amplitudeB} min={5} max={25} step={1} unit=" µV" onChange={setAmplitudeB} /><button type="button" onClick={() => { setCorrelation(0); setAmplitudeB(10) }}>Match the reference</button></div>
          <div className="lesson-map"><span className="lesson-eyebrow">The same trial, in new coordinates</span><Matrix entries={regularized} name="C" /><p>Fixed teaching reference: R = 100I</p><div className="lesson-equation">L = log(R⁻¹ᐟ² C R⁻¹ᐟ²)</div><div className="lesson-feature-vector" aria-label="Tangent-space feature vector">{features.map((f, i) => <div key={i}><span>{['L₁₁', '√2 L₁₂', 'L₂₂'][i]}</span><strong>{fmt(f, 3)}</strong></div>)}</div><p>One trial is now one point with three coordinates. Match C to R and all three become zero.</p></div></div>
        <aside className="lesson-note"><strong>What “tangent space” means:</strong> it provides ordinary vector coordinates around a reference covariance, respecting the matrices’ geometry. Like a local map, it makes comparisons convenient without preserving every global distance. This is a space of signal patterns, not the physical space inside the head. The app estimates its Riemannian reference mean from <strong>training trials only</strong>, then reuses it for test trials.</aside>
        <details><summary>Extension: matrix log, positive definiteness and √2</summary><p>For a symmetric 2×2 matrix, positive definiteness requires C₁₁ &gt; 0 and C₁₁C₂₂ − C₁₂² &gt; 0. Shrinkage helps avoid singular matrices. To compute the matrix log, rotate into eigenvector directions, take the logarithm of each positive eigenvalue, then rotate back. It is <strong>not</strong> the logarithm of each entry.</p><p>Because L is symmetric, its off-diagonal entry occurs twice. Storing √2 L₁₂ once preserves its contribution to the sum of squares: L₁₁² + 2L₁₂² + L₂₂².</p><p>For n channels, there are n(n+1)/2 features. Eight channels produce 36 features, not eight possible mental states. Our 2×2 calculation follows pyRiemann’s Riemannian mapping, with a deliberately fixed R = 100I.</p></details>
      </>}
      {chapter === 3 && <>
        <div className="lesson-intro"><span className="lesson-eyebrow">04 / Weighted sums &amp; the exponential function</span><h3>Turn a score into a probability</h3><p>Logistic regression adds weighted features and an intercept. The sigmoid maps that score onto a number between 0 and 1. Despite its name, this is a classification method.</p></div>
        <div className="lesson-two"><div><div className="lesson-equation">z = b + w₁f₁ + w₂f₂ + w₃f₃<br />p(B) = 1 / (1 + e⁻ᶻ)</div><p>Our invented labels are <strong>Pattern A</strong> and <strong>Pattern B</strong>, not real mental states. We hand-set w₁ = −1 and w₃ = 1; adjust w₂ and b below.</p>
          <Slider name="Weight on the cross-channel feature" value={weight} min={-3} max={3} step={0.1} onChange={setWeight} /><Slider name="Intercept b" value={intercept} min={-3} max={3} step={0.1} onChange={setIntercept} />
          <div className="lesson-equation">z = {fmt(intercept)} + ({fmt(prediction.contributions[0])}) + ({fmt(prediction.contributions[1])}) + ({fmt(prediction.contributions[2])}) = {fmt(prediction.z)}</div>
          <output className="lesson-probability" aria-live="polite">p(Pattern B) = {(prediction.probability * 100).toFixed(1)}%</output><p>At p = 0.5, z = 0. Using a 0.5 threshold, this example chooses <strong>Pattern {prediction.probability >= 0.5 ? 'B' : 'A'}</strong>{Math.abs(prediction.probability - 0.5) < 1e-10 ? ' (tie assigned to B)' : ''}.</p>
          <p className="lesson-challenge"><strong>Try it:</strong> change the weight’s sign. Then return to covariance and change the channel relationship. The same features feed this prediction.</p></div><SigmoidPlot z={prediction.z} probability={prediction.probability} /></div>
        <aside className="lesson-note"><strong>How the real model learns:</strong> it adjusts weights on labelled training trials to minimise log loss, with a penalty on large weights. A confident wrong prediction is penalised heavily. These sliders illustrate the prediction equation; they do not train a model or modify Experiment Lab. For more than two classes, the app uses a multinomial model with softmax probabilities.</aside>
        <details><summary>Extension: the loss for one training example</summary><div className="lesson-equation">loss = −[y ln p + (1−y) ln(1−p)]</div><p>Here y = 1 for B and y = 0 for A. When the true label is B, p = 0.9 gives loss ≈ 0.105; p = 0.1 gives ≈ 2.303. The optimiser uses many labelled examples, not the answer to the final test.</p></details>
        <p>A reported probability of 90% is not proof of the person’s thoughts, and does not by itself mean 90% of such predictions are correct. That calibration must be measured on fresh data.</p>
      </>}
      {chapter === 4 && <>
        <div className="lesson-intro"><span className="lesson-eyebrow">05 / Put the method to the test</span><h3>What would count as evidence?</h3><p>The mathematical pipeline can produce predictions even from noise. A good experiment asks whether they beat a suitable baseline on data the model has not seen.</p></div>
        <KnowledgeCheck />
        <aside className="lesson-note"><strong>Plan your own comparison:</strong> collect repeated trials of two clearly defined tasks; review artefacts without looking at prediction success; train on one recording and test on a fresh recording, ideally on a later day. Report per-class results, excluded trials and limitations. For balanced two-class data, random guessing averages 50%; an unbalanced dataset also needs a majority-class baseline or balanced accuracy.</aside>
        <p><strong>For your write-up:</strong> explain why filtering helps, show a covariance calculation, describe how training and testing were separated, and discuss whether the result might be driven by eye or muscle activity. A result near chance is still useful evidence.</p>
        <details><summary>Map this lesson to Experiment Lab</summary><ul><li>The lesson uses one second and two channels; the app uses a three-second segment after one second of settling.</li><li>The lesson removes known sine components exactly; the app applies a Butterworth bandpass.</li><li>The lesson fixes shrinkage at 10% and R at 100I; the app uses OAS and learns R from training data.</li><li>The lesson has hand-set binary weights; the app fits logistic regression and can support two to four task labels.</li><li>No lesson control changes recording settings or the fitted classifier.</li></ul></details>
      </>}
    </div>
    <footer className="lesson-footer"><button type="button" onClick={() => setChapter(c => c - 1)} disabled={chapter === 0}><ArrowLeft size={16} />Previous</button><span>{chapter + 1} / {chapters.length}</span><button type="button" onClick={() => chapter < 4 ? setChapter(c => c + 1) : onClose()}>{chapter < 4 ? 'Next step' : 'Back to experiment'}<ArrowRight size={16} /></button><button type="button" onClick={reset}><RotateCcw size={15} />Reset sliders</button></footer>
    <details className="lesson-sources"><summary>Sources &amp; further reading</summary><p>Method references: <a href={sources.covariance} target="_blank" rel="noreferrer">scikit-learn: covariance and shrinkage</a>; <a href={sources.tangent} target="_blank" rel="noreferrer">pyRiemann: tangent-space features</a>; <a href={sources.logistic} target="_blank" rel="noreferrer">scikit-learn: logistic regression</a>. Matrix geometry is extension material; the core lesson assumes means, variance, functions and logarithms.</p></details>
  </section>
}
