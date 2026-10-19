import { useState } from 'react'
import { getResumeCoach, type ResumeCoachResult } from '../api/career'
import type { ParsedResumeData } from '../api/resume'
import styles from './ResumeCoachPanel.module.css'

export default function ResumeCoachPanel({ resume }: { resume: ParsedResumeData }) {
  const [result, setResult] = useState<ResumeCoachResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    if (loading) return
    setLoading(true); setError('')
    try { setResult(await getResumeCoach(resume)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Resume Coach is unavailable.') }
    finally { setLoading(false) }
  }
  return <section className={styles.card}>
    <div className={styles.header}><div><span>Resume Coach</span><h3>Strengthen the evidence already on your resume</h3></div>
      <button className="btn-outline" disabled={loading} onClick={() => void load()}>{loading ? 'Reviewing…' : result ? 'Review again' : 'Run Resume Coach'}</button></div>
    <p className={styles.notice}>Uses professional resume content only. It will not invent experience, skills, or metrics.</p>
    {result && <div className={styles.results}>
      <p className={styles.source}>{result.source === 'ai' ? 'AI coaching active' : 'Standard resume guidance'}{result.cached ? ' · saved result' : ''}</p>
      {result.strongest_evidence.length > 0 && <div><strong>Strongest evidence</strong><ul>{result.strongest_evidence.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {result.bullet_coaching.length > 0 && <div><strong>Bullets to strengthen</strong>{result.bullet_coaching.map(item => <blockquote key={item.evidence}><p>{item.evidence}</p><span>{item.issue} {item.recommendation}</span></blockquote>)}</div>}
      {result.skills_without_evidence.length > 0 && <p><strong>Skills needing evidence:</strong> {result.skills_without_evidence.join(' · ')}</p>}
      {result.summary_guidance.length > 0 && <div><strong>Summary guidance</strong><ul>{result.summary_guidance.map(item => <li key={item}>{item}</li>)}</ul></div>}
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>
}
