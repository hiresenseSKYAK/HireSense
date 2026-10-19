import { useState } from 'react'
import type { ParsedResumeData } from '../api/resume'
import { getJobPreparation, type JobPreparationResult } from '../api/career'
import styles from './JobPreparationPanel.module.css'

export default function JobPreparationPanel({ jobId, resume }: { jobId: number; resume: ParsedResumeData | null }) {
  const [result, setResult] = useState<JobPreparationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!resume || loading) return
    setLoading(true); setError('')
    try { setResult(await getJobPreparation(jobId, resume)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Personalized preparation is unavailable.') }
    finally { setLoading(false) }
  }

  return <section className={styles.card}>
    <div className={styles.eyebrow}>Personalized preparation</div>
    <h2>Why this role fits—and what to prepare</h2>
    <p>See evidence-backed fit, application talking points, recruiter questions, and a short skill-gap plan.</p>
    <p className={styles.notice}>AI coaching uses relevant job and resume information. Contact details are excluded.</p>
    {!resume ? <p>Upload a resume to unlock this guidance.</p> : !result ?
      <button className="btn-outline" disabled={loading} onClick={() => void load()}>{loading ? 'Preparing guidance…' : 'Prepare for this role'}</button> :
      <div className={styles.results}>
        <div className={styles.band}>{result.alignment === 'Strong alignment' ? 'High priority' : result.alignment === 'Moderate alignment' ? 'Worth considering' : 'Low priority'}</div>
        <p>Should you spend time applying? This priority reflects listed requirements and resume evidence—not hiring odds or a guarantee that the posting is still open.</p>
        <p className={styles.source}>{result.source === 'ai' ? 'AI coaching active' : 'Standard guidance'}{result.cached ? ' · saved result' : ''}</p>
        {result.strongest_matches.length > 0 && <div><h3>Why it fits you · your best resume evidence</h3><ul>{result.strongest_matches.map(item => <li key={`${item.requirement}:${item.resume_evidence}`}><strong>{item.requirement}:</strong> {item.resume_evidence}</li>)}</ul></div>}
        {result.missing_requirements.length > 0 && <div><h3>What may hold you back</h3><p>{result.missing_requirements.slice(0, 3).join(' · ')}</p></div>}
        {result.experiences_to_emphasize.length > 0 && <div><h3>What to emphasize in your application</h3><ul>{result.experiences_to_emphasize.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {result.likely_interview_topics.length > 0 && <div><h3>Likely interview areas</h3><p>{result.likely_interview_topics.join(' · ')}</p></div>}
        {result.resume_tailoring.length > 0 && <div><h3>Tailor your resume for this role</h3>{result.resume_tailoring.map(item => <div key={item.evidence} className={styles.gap}><strong>{item.evidence}</strong><p>{item.recommendation}</p></div>)}</div>}
        {result.application_talking_points.length > 0 && <div><h3>Application talking points</h3><ul>{result.application_talking_points.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {result.professional_summary && <div><h3>Professional summary draft</h3><p>{result.professional_summary}</p></div>}
        {result.recruiter_screen_questions.length > 0 && <div><h3>Likely recruiter-screen questions</h3><ul>{result.recruiter_screen_questions.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {result.skill_gaps.length > 0 && <div><h3>Priority skill gaps</h3>{result.skill_gaps.map(item => <div key={item.skill} className={styles.gap}><strong>{item.skill} · {item.status}</strong><p>{item.why_it_matters}</p><ul>{item.next_steps.map(step => <li key={step}>{step}</li>)}</ul></div>)}</div>}
        <button className="btn-outline" onClick={() => void load()} disabled={loading}>Retry guidance</button>
      </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>
}
