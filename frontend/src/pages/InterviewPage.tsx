import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { fetchJob } from '../api/jobs'
import { getResumeAnalysis } from '../utils/resumeStorage'
import {
  getInterviewHistory, getInterviewReport, getInterviewSession, InterviewApiError,
  interviewRecoveryKey, startInterview, submitInterviewAnswer, type InterviewDifficulty, type InterviewFeedback,
  type InterviewFocus, type InterviewHistoryItem, type InterviewMode, type InterviewQuestion,
  type InterviewReport, type InterviewScoreDimension,
} from '../api/interview'
import type { Job } from '../types'
import styles from './InterviewPage.module.css'

const modes: { value: InterviewMode; label: string; description: string }[] = [
  { value: 'mixed', label: 'Mixed', description: 'A balanced, real-world conversation' },
  { value: 'behavioral', label: 'Behavioral', description: 'Stories, decisions, and impact' },
  { value: 'technical', label: 'Technical', description: 'Depth, tradeoffs, and problem solving' },
  { value: 'role_specific', label: 'Role-specific', description: 'What this job is likely to demand' },
]
const focusOptions: { value: InterviewFocus; label: string }[] = [
  { value: 'technical_depth', label: 'Technical depth' },
  { value: 'behavioral_storytelling', label: 'Behavioral storytelling' },
  { value: 'resume_projects', label: 'Project ownership' },
  { value: 'system_design_reasoning', label: 'System/design reasoning' },
  { value: 'communication', label: 'Communication' },
  { value: 'weak_skill_areas', label: 'Weak skill areas' },
  { value: 'job_requirements', label: 'Job requirements' },
]

function readable(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) }
function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) }
function coachingSource(source: 'ai' | 'fallback') { return source === 'ai' ? 'AI coaching' : 'Standard coaching' }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.' }

type SpeechRecognitionCtor = new () => {
  continuous: boolean; interimResults: boolean; lang: string
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void
}
function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const browser = window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return browser.SpeechRecognition || browser.webkitSpeechRecognition || null
}

function Dimensions({ items }: { items?: InterviewScoreDimension[] }) {
  if (!items?.length) return null
  return <div className={styles.dimensions} aria-label="Score dimensions">
    {items.map(item => <div className={styles.dimension} key={item.label}>
      <div className={styles.dimensionTop}><span>{item.label}</span><strong>{item.score}/{item.max_score}</strong></div>
      <div className={styles.track}><span style={{ width: `${Math.min(100, item.score / item.max_score * 100)}%` }} /></div>
    </div>)}
  </div>
}

function FeedbackDetails({ feedback }: { feedback: InterviewFeedback }) {
  return <>
    <Dimensions items={feedback.dimensions} />
    <div className={styles.twoColumn}>
      <section className={styles.editorialBlock}><h3>What landed</h3>
        {feedback.strengths.length ? <ul>{feedback.strengths.map(item => <li key={item}>{item}</li>)}</ul> : <p>No particular strength was identified in this answer.</p>}
      </section>
      <section className={styles.editorialBlock}><h3>What to strengthen</h3>
        {feedback.improvements.length ? <ul>{feedback.improvements.map(item => <li key={item}>{item}</li>)}</ul> : <p>No specific improvement was identified in this answer.</p>}
      </section>
    </div>
    {feedback.suggested_approach && <section className={styles.editorialBlock}><h3>How to make it stronger</h3><p>{feedback.suggested_approach}</p></section>}
    {feedback.example_stronger_framing && <section className={styles.editorialBlock}><h3>Example stronger framing</h3><p>{feedback.example_stronger_framing}</p></section>}
    {(feedback.technical_depth || feedback.communication || feedback.role_relevance) &&
      <details className={styles.details}><summary>More coaching detail</summary>
        {feedback.technical_depth && <p><strong>Technical depth:</strong> {feedback.technical_depth}</p>}
        {feedback.communication && <p><strong>Communication:</strong> {feedback.communication}</p>}
        {feedback.role_relevance && <p><strong>Role relevance:</strong> {feedback.role_relevance}</p>}
      </details>}
  </>
}

function PracticeActions({ report }: { report: InterviewReport }) {
  const target = `/interviews/new/${report.job_id}`
  const result = report.final_result
  const opportunity = [...result.next_steps, ...(result.skill_gaps_exposed ?? []),
    ...(result.specificity_needs ?? []), ...(result.practice_recommendations ?? [])].join(' ').toLowerCase()
  const focus: InterviewFocus = result.skill_gaps_exposed?.length ? 'weak_skill_areas' :
    /system design|architecture|tradeoff/.test(opportunity) ? 'system_design_reasoning' :
    /technical|algorithm|code/.test(opportunity) ? 'technical_depth' :
    /story|behavioral/.test(opportunity) ? 'behavioral_storytelling' :
    /project|ownership/.test(opportunity) ? 'resume_projects' :
    /communicat|clarity|concise/.test(opportunity) ? 'communication' : 'weak_skill_areas'
  return <div className={styles.practiceActions}>
    <Link className="btn-primary" to={`${target}?focus=${focus}`}>Practice weak areas</Link>
    <Link className="btn-outline" to={`${target}?difficulty=challenging`}>Challenge me harder</Link>
    <Link className="btn-outline" to={`${target}?mode=technical`}>Technical interview</Link>
    <Link className="btn-outline" to={`${target}?mode=behavioral`}>Behavioral interview</Link>
    <Link className={styles.textLink} to={target}>Try this role again</Link>
  </div>
}

function Debrief({ report }: { report: InterviewReport }) {
  const result = report.final_result
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <main className={styles.report}>
    <div className={styles.kicker}>Interview debrief</div>
    <div className={styles.reportHeading}><div><h1 tabIndex={-1} ref={heading}>{report.job_title}</h1><p>{report.company} · {readable(report.mode)} · {readable(report.difficulty)} · {dateLabel(report.completed_at)}</p></div><Link to="/interviews" className={styles.textLink}>All interviews</Link></div>
    <section className={styles.resultHero} aria-labelledby="overall-title">
      <div><span className={styles.kicker} id="overall-title">Overall coaching result</span><div className={styles.bigScore}>{result.final_score}<span>/100</span></div><strong>{result.overall_band || 'Interview complete'}</strong></div>
      <div><h2>How you came across</h2><p>{result.overall_summary}</p><small>{coachingSource(result.source)} · Scores are coaching signals, not hiring probabilities.</small></div>
    </section>
    <Dimensions items={result.dimensions} />
    <div className={styles.twoColumn}>
      <section className={styles.editorialBlock}><span className={styles.kicker}>Strongest signal</span><h2>What worked</h2><ul>{result.top_strengths.map(item => <li key={item}>{item}</li>)}</ul></section>
      <section className={styles.editorialBlock}><span className={styles.kicker}>Biggest opportunity</span><h2>What to improve</h2><ul>{result.next_steps.map(item => <li key={item}>{item}</li>)}</ul></section>
    </div>
    {(result.technical_signals || result.behavioral_signals || result.communication_signals) && <section className={styles.reportSection}><h2>Performance by signal</h2><div className={styles.signalGrid}>
      {result.technical_signals && <div><h3>Technical</h3><p>{result.technical_signals}</p></div>}
      {result.behavioral_signals && <div><h3>Behavioral</h3><p>{result.behavioral_signals}</p></div>}
      {result.communication_signals && <div><h3>Communication</h3><p>{result.communication_signals}</p></div>}
    </div></section>}
    {result.patterns_across_answers?.length ? <section className={styles.reportSection}><h2>Patterns across answers</h2><ul>{result.patterns_across_answers.map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    <section className={styles.reportSection}><div className={styles.sectionHeading}><div><span className={styles.kicker}>Your conversation</span><h2>Question-by-question review</h2></div><span>{report.turns.length} responses</span></div>
      <div className={styles.reviewList}>{report.turns.map(turn => <details className={styles.reviewItem} key={turn.question_index}>
        <summary><span className={styles.reviewIndex}>{String(turn.question_index).padStart(2, '0')}</span><span>{turn.is_follow_up && <small>Follow-up · </small>}{turn.question}</span><strong>{turn.feedback.score}/100</strong></summary>
        <div className={styles.reviewBody}><div><h3>Your answer</h3><p className={styles.answerCopy}>{turn.answer}</p></div><p>{turn.feedback.summary}</p><FeedbackDetails feedback={turn.feedback} /></div>
      </details>)}</div>
    </section>
    {(result.job_readiness_areas?.length || result.skill_gaps_exposed?.length) ? <section className={styles.reportSection}><h2>Readiness for this role</h2><div className={styles.twoColumn}>
      {!!result.job_readiness_areas?.length && <div><h3>Job-specific readiness</h3><ul>{result.job_readiness_areas.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {!!result.skill_gaps_exposed?.length && <div><h3>Skills to develop</h3><ul>{result.skill_gaps_exposed.map(item => <li key={item}>{item}</li>)}</ul></div>}
    </div></section> : null}
    <section className={styles.nextPanel}><span className={styles.kicker}>Keep the momentum</span><h2>Your next practice session</h2>
      {result.recommended_next_session && <p>{result.recommended_next_session}</p>}
      {!!result.practice_questions?.length && <><h3>Questions worth practicing</h3><ol>{result.practice_questions.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ol></>}
      {!!result.personalized_action_plan?.length && <><h3>Action plan</h3><ol>{result.personalized_action_plan.map(item => <li key={item}>{item}</li>)}</ol></>}
      <PracticeActions report={report} />
    </section>
  </main>
}

function History() {
  const [items, setItems] = useState<InterviewHistoryItem[] | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => { let active = true; getInterviewHistory().then(data => { if (active) setItems(data) }).catch(caught => { if (active) setError(errorText(caught)) }); return () => { active = false } }, [retry])
  return <main className={styles.report}><span className={styles.kicker}>Your practice</span><h1>Interview history</h1><p className={styles.lead}>Return to your coaching, review a response, or practice a role again.</p>
    {error && <div role="alert" className={styles.error}>{error} <button className="btn-outline" onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry</button></div>}
    {!items && !error && <p role="status">Loading your interviews…</p>}
    {items?.length === 0 && <div className={styles.empty}><h2>Your practice story starts here.</h2><p>Open a job and choose Practice this role to begin a personalized interview.</p><Link className="btn-primary" to="/">Explore jobs</Link></div>}
    {!!items?.length && <div className={styles.historyList}>{items.map(item => <Link to={`/interviews/${item.session_id}`} className={styles.historyItem} key={item.session_id}>
      <div><span className={styles.kicker}>{item.company}</span><h2>{item.job_title}</h2><p>{dateLabel(item.completed_at)} · {readable(item.mode)} · {readable(item.difficulty)}</p></div>
      <div className={styles.historySignals}><span><strong>{item.final_score}</strong>/100 · {item.overall_band}</span>{item.major_strengths[0] && <small>Strength · {item.major_strengths[0]}</small>}{item.improvement_areas[0] && <small>Next · {item.improvement_areas[0]}</small>}</div>
      <span aria-hidden="true">↗</span>
    </Link>)}</div>}
  </main>
}

function InterviewExperience() {
  const { jobId, sessionId } = useParams()
  const [search] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const resume = getResumeAnalysis()?.parsed_data ?? null
  const recoveryKey = jobId && resume ? interviewRecoveryKey(Number(jobId), resume) : null
  const [job, setJob] = useState<Job | null>(null)
  const [loadingJob, setLoadingJob] = useState(Boolean(jobId))
  const [resumeSessionId, setResumeSessionId] = useState<number | null>(null)
  const [mode, setMode] = useState<InterviewMode>(() => modes.some(item => item.value === search.get('mode')) ? search.get('mode') as InterviewMode : 'mixed')
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>(() => ['warm_up', 'realistic', 'challenging'].includes(search.get('difficulty') || '') ? search.get('difficulty') as InterviewDifficulty : 'realistic')
  const [count, setCount] = useState<3 | 5 | 8>(5)
  const [focus, setFocus] = useState<InterviewFocus[]>(() => focusOptions.filter(item => item.value === search.get('focus')).map(item => item.value))
  const [question, setQuestion] = useState<InterviewQuestion | null>(() => (location.state as { firstQuestion?: InterviewQuestion } | null)?.firstQuestion ?? null)
  const [sessionJobId, setSessionJobId] = useState<number | null>(() => (location.state as { jobId?: number } | null)?.jobId ?? null)
  const [nextQuestion, setNextQuestion] = useState<InterviewQuestion | null>(null)
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [answer, setAnswer] = useState('')
  const [submittedAnswer, setSubmittedAnswer] = useState('')
  const [report, setReport] = useState<InterviewReport | null>(null)
  const [reportReady, setReportReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState('')
  const [authNeeded, setAuthNeeded] = useState(false)
  const [retry, setRetry] = useState(0)
  const [listening, setListening] = useState(false)
  const recognition = useRef<InstanceType<SpeechRecognitionCtor> | null>(null)
  const speechBase = useRef('')
  const busy = useRef(false)
  const stageHeading = useRef<HTMLHeadingElement>(null)
  const total = question?.total_questions ?? nextQuestion?.total_questions
  const index = question?.question_index ?? (feedback ? (nextQuestion?.question_index ? nextQuestion.question_index - 1 : total) : undefined)

  function clearRecovery(completedJobId: number) {
    const key = resume ? interviewRecoveryKey(completedJobId, resume) : null
    try { if (key) sessionStorage.removeItem(key) } catch { /* Storage is optional. */ }
  }

  useEffect(() => () => recognition.current?.stop(), [])

  function stopListening() { recognition.current?.stop(); recognition.current = null; setListening(false) }
  function toggleListening() {
    if (listening) { stopListening(); return }
    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
    const instance = new Ctor()
    instance.continuous = true; instance.interimResults = true; instance.lang = 'en-US'
    speechBase.current = answer.trim()
    instance.onresult = event => {
      if (recognition.current !== instance) return
      let spoken = ''
      for (let index = 0; index < event.results.length; index += 1) spoken += ` ${event.results[index][0]?.transcript ?? ''}`
      setAnswer([speechBase.current, spoken.trim()].filter(Boolean).join(' ').slice(0, 5000))
    }
    instance.onerror = event => { setListening(false); if (event.error === 'not-allowed') setError('Allow microphone access to dictate your answer.') }
    instance.onend = () => setListening(false)
    recognition.current = instance
    setError('')
    try { instance.start(); setListening(true) } catch { setError('Voice input could not start.'); setListening(false) }
  }

  useEffect(() => {
    if (!jobId) return
    let active = true
    setLoadingJob(true)
    fetchJob(Number(jobId)).then(data => { if (active) setJob(data) }).catch(caught => { if (active) setError(errorText(caught)) }).finally(() => { if (active) setLoadingJob(false) })
    return () => { active = false }
  }, [jobId, retry])

  useEffect(() => {
    if (!recoveryKey || !jobId) return
    let stored: number | null = null
    try { const value = sessionStorage.getItem(recoveryKey); stored = value ? Number(value) : null } catch { /* Storage is optional. */ }
    if (!stored || !Number.isInteger(stored)) return
    let active = true
    getInterviewSession(stored).then(state => {
      if (!active) return
      if (state.job_id === Number(jobId) && state.status === 'in_progress') setResumeSessionId(stored)
      else { try { sessionStorage.removeItem(recoveryKey) } catch { /* Storage is optional. */ } }
    }).catch(() => { if (active) { try { sessionStorage.removeItem(recoveryKey) } catch { /* Storage is optional. */ } } })
    return () => { active = false }
  }, [jobId, recoveryKey])

  useEffect(() => {
    if (!sessionId || question) return
    let active = true
    setLoading(true)
    getInterviewSession(Number(sessionId)).then(async state => {
      if (!active) return
      setSessionJobId(state.job_id)
      if (state.status === 'completed') {
        const data = await getInterviewReport(Number(sessionId))
        if (active) { clearRecovery(data.job_id); setReport(data); setReportReady(true) }
      } else if (state.last_response && state.current_question) {
        setFeedback(state.last_response.feedback)
        setNextQuestion(state.current_question)
      } else setQuestion(state.current_question)
    }).catch(caught => { if (active) { setError(errorText(caught)); setAuthNeeded(caught instanceof InterviewApiError && caught.status === 401) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sessionId, retry]) // The initial question is passed through route state; reloads recover from the server.

  useEffect(() => { if (!evaluating) stageHeading.current?.focus() }, [evaluating, feedback, reportReady, question?.question_id])

  async function begin() {
    if (!job || !resume || busy.current) return
    busy.current = true
    setLoading(true); setError('')
    try {
      const firstQuestion = await startInterview(job.id, resume, { mode, difficulty, question_count: count, focus })
      try { if (recoveryKey) sessionStorage.setItem(recoveryKey, String(firstQuestion.session_id)) } catch { /* Storage is optional. */ }
      setQuestion(firstQuestion)
      navigate(`/interviews/${firstQuestion.session_id}`, { state: { firstQuestion, jobId: job.id } })
    } catch (caught) { setError(errorText(caught)); setAuthNeeded(caught instanceof InterviewApiError && caught.status === 401) }
    finally { setLoading(false); busy.current = false }
  }

  async function submit() {
    if (!question || !answer.trim() || busy.current) return
    busy.current = true
    setEvaluating(true); setError('')
    stopListening()
    try {
      const result = await submitInterviewAnswer(question.session_id, answer.trim(), question.question_id)
      setSubmittedAnswer(answer.trim())
      setAnswer('')
      setQuestion(null)
      setFeedback(result.feedback)
      setNextQuestion(result.next_question)
      if (result.is_complete) {
        const data = await getInterviewReport(question.session_id)
        clearRecovery(data.job_id)
        setReport(data)
      }
    } catch (caught) { setError(errorText(caught)); setAuthNeeded(caught instanceof InterviewApiError && caught.status === 401) }
    finally { setEvaluating(false); busy.current = false }
  }

  if (!jobId && !sessionId) return <History />

  if (jobId) return <main className={styles.shell}>
    <Link className={styles.back} to={`/jobs/${jobId}`}>← Back to role</Link>
    {loadingJob ? <p role="status">Preparing this role…</p> : job ? <div className={styles.preflight}>
      <div className={styles.preflightIntro}><span className={styles.kicker}>HireSense interview practice</span><h1>Step into your next interview.</h1><p>A focused interview built around this role and your professional experience. Choose your pace, then step into the room.</p><div className={styles.roleLine}><strong>{job.title}</strong><span>{job.company} · {job.location}</span></div></div>
      <div className={styles.preflightForm}>
        <div className={styles.preflightMeta}><span>Resume signal <strong>{resume ? 'Ready' : 'Needed'}</strong></span><span>Estimated time <strong>{count === 3 ? '5' : count === 5 ? '8' : '12'} minutes</strong></span></div>
        {!resume && <div className={styles.error}>Upload a resume to personalize this interview. <Link to="/resume">Upload resume →</Link></div>}
        {resumeSessionId && <div className={styles.resumePrompt}><div><strong>Continue where you left off</strong><p>Your unfinished interview is ready to resume.</p></div><Link className="btn-outline" to={`/interviews/${resumeSessionId}`}>Resume interview →</Link></div>}
        <fieldset><legend>Interview type</legend><div className={styles.modeGrid}>{modes.map(item => <label className={`${styles.choice} ${mode === item.value ? styles.selected : ''}`} key={item.value}><input type="radio" name="mode" value={item.value} checked={mode === item.value} onChange={() => setMode(item.value)} /><strong>{item.label}</strong><small>{item.description}</small></label>)}</div></fieldset>
        <div className={styles.selectRow}><label>Difficulty<select value={difficulty} onChange={event => setDifficulty(event.target.value as InterviewDifficulty)}><option value="warm_up">Warm-up</option><option value="realistic">Realistic</option><option value="challenging">Challenging</option></select></label><label>Questions<select value={count} onChange={event => setCount(Number(event.target.value) as 3 | 5 | 8)}><option value={3}>3 questions</option><option value={5}>5 questions</option><option value={8}>8 questions</option></select></label></div>
        <fieldset><legend>Focus areas <small>Optional · choose up to 3</small></legend><div className={styles.chips}>{focusOptions.map(item => <button type="button" key={item.value} className={focus.includes(item.value) ? styles.activeChip : styles.chip} aria-pressed={focus.includes(item.value)} disabled={!focus.includes(item.value) && focus.length >= 3} onClick={() => setFocus(current => current.includes(item.value) ? current.filter(value => value !== item.value) : [...current, item.value])}>{item.label}</button>)}</div></fieldset>
        <p className={styles.finePrint}>Follow-ups count toward your selected total. Relevant job and resume details are used for coaching; contact details are excluded.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button className="btn-primary" disabled={!resume || loading} onClick={() => void begin()}>{loading ? 'Preparing your questions…' : 'Begin interview →'}</button>
      </div>
    </div> : <div role="alert" className={styles.empty}>{error || 'This role is unavailable.'}<button className="btn-outline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
  </main>

  if (reportReady && report) return <Debrief report={report} />
  return <main className={styles.room} aria-busy={loading || evaluating}>
    <div className={styles.roomTop}><Link to="/interviews" className={styles.roomBrand}>HireSense <span>/ Interview</span></Link><div className={styles.roomProgress} role="status" aria-live="polite">{index && total ? `Question ${index} of ${total}` : 'Interview session'}</div><Link to={sessionJobId ? `/interviews/new/${sessionJobId}` : '/interviews'} className={styles.exit}>Exit interview</Link></div>
    {total && <div className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, (Number(index) - (feedback ? 0 : 1)) / total * 100)}%` }} /></div>}
    <div className={styles.stage}>
      {loading && <div role="status" className={styles.loadingState}>Loading your interview…</div>}
      {error && <div role="alert" className={styles.error}>{error}<div className={styles.actions}>{!question && <button className="btn-outline" onClick={() => setRetry(value => value + 1)}>Retry session</button>}{authNeeded && <Link className="btn-outline" to="/login">Sign in again</Link>}<Link className="btn-outline" to="/interviews">Interview history</Link></div></div>}
      {evaluating && <div className={styles.evaluating} role="status" aria-live="polite"><span className={styles.kicker}>Reviewing your response</span><h1>Analyzing your answer…</h1><p>Looking for relevant evidence, clarity, and role-specific depth.</p><div className={styles.pulseLine} /></div>}
      {!evaluating && question && <div className={styles.questionStage}><span className={styles.kicker}>{question.is_follow_up ? 'Follow-up · building on your answer' : question.focus_area}</span><h1 tabIndex={-1} ref={stageHeading}>{question.prompt}</h1><p className={styles.questionMeta}>{readable(question.mode)} interview · {question.source === 'fallback' ? 'Guided practice' : 'Personalized question'}</p>
        {!!question.tips.length && <details className={styles.details}><summary>Need help structuring your answer?</summary><ul>{question.tips.map(tip => <li key={tip}>{tip}</li>)}</ul></details>}
        <div className={styles.answerArea}><div className={styles.answerLabel}><label htmlFor="interview-answer">Your answer</label>{speechRecognitionCtor() && <button type="button" className={styles.voiceButton} aria-pressed={listening} onClick={toggleListening}>{listening ? 'Stop dictation' : 'Dictate answer'}</button>}</div><textarea id="interview-answer" maxLength={5000} value={answer} onChange={event => { if (listening) stopListening(); setAnswer(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() } }} placeholder="Take a moment to think, then respond in your own words…" /><div className={styles.answerFooter}><span>{answer.trim() ? `${answer.trim().split(/\s+/).length} words` : 'A concrete example works best.'}</span><button className="btn-primary" disabled={!answer.trim()} onClick={() => void submit()}>Submit answer <span aria-hidden="true">↗</span></button></div><small>Tip: Ctrl/Cmd + Enter to submit</small></div>
      </div>}
      {!evaluating && feedback && <div className={styles.feedbackStage}><span className={styles.kicker}>Answer review · {coachingSource(feedback.source)}</span><h1 tabIndex={-1} ref={stageHeading}>{feedback.benchmark || 'Your feedback'}</h1><div className={styles.feedbackIntro}><strong>{feedback.score}<span>/100</span></strong><p>{feedback.summary}</p></div><p className={styles.finePrint}>Coaching feedback, not a hiring prediction.</p>{submittedAnswer && <details className={styles.details}><summary>Review your answer</summary><p className={styles.answerCopy}>{submittedAnswer}</p></details>}<FeedbackDetails feedback={feedback} /><div className={styles.actions}>{nextQuestion ? <button className="btn-primary" onClick={() => { setQuestion(nextQuestion); setNextQuestion(null); setFeedback(null); setSubmittedAnswer('') }}>Continue to next question →</button> : report ? <button className="btn-primary" onClick={() => setReportReady(true)}>View full debrief →</button> : <span role="status">Preparing your debrief…</span>}</div></div>}
    </div>
  </main>
}

export default function InterviewPage() {
  const location = useLocation()
  return <InterviewExperience key={`${location.pathname}${location.search}`} />
}
