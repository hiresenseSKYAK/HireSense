import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedResumeData } from '../api/resume'
import {
  startInterview,
  submitInterviewAnswer,
  type FinalInterviewResult,
  type InterviewFeedback,
  type InterviewMode,
  type InterviewQuestion,
  type InterviewScoreDimension,
} from '../api/interview'
import styles from './AIInterviewPanel.module.css'

function scoreTone(score: number) {
  if (score >= 70) return styles.scoreStrong
  if (score >= 50) return styles.scoreMid
  return styles.scoreLow
}

function DimensionList({ dimensions }: { dimensions?: InterviewScoreDimension[] }) {
  if (!dimensions || dimensions.length === 0) {
    return null
  }

  return (
    <ul className={styles.dimensionList}>
      {dimensions.map((item) => (
        <li key={item.label} className={styles.dimensionItem}>
          <span>{item.label}</span>
          <span className={styles.dimensionScore}>{item.score}/{item.max_score}</span>
        </li>
      ))}
    </ul>
  )
}

type SpeechRecognitionCtor = new () => {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: {
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
  }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const browser = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return browser.SpeechRecognition || browser.webkitSpeechRecognition || null
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  )
}

type Props = {
  jobId: number
  jobTitle: string
  company: string
  resumeData: ParsedResumeData | null
}

export default function AIInterviewPanel({
  jobId,
  jobTitle,
  company,
  resumeData,
}: Props) {
  const [mode, setMode] = useState<InterviewMode>('mixed')
  const [questionCount, setQuestionCount] = useState<3 | 5 | 8>(5)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const operationRef = useRef(0)
  const busyRef = useRef(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null)
  const [draftAnswer, setDraftAnswer] = useState('')
  const [submittedAnswer, setSubmittedAnswer] = useState('')
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [pendingNextQuestion, setPendingNextQuestion] = useState<InterviewQuestion | null>(null)
  const [finalResult, setFinalResult] = useState<FinalInterviewResult | null>(null)
  const [error, setError] = useState('')
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null)
  const speechBaseRef = useRef('')
  const speechSupported = speechRecognitionCtor() !== null

  const stopListening = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsListening(false)
  }

  useEffect(() => () => recognitionRef.current?.stop(), [])

  const toggleListening = () => {
    if (isListening) {
      stopListening()
      return
    }

    const Ctor = speechRecognitionCtor()
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    speechBaseRef.current = draftAnswer.trim()
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return
      let finalText = ''
      let interimText = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const piece = event.results[index][0]?.transcript ?? ''
        if (event.results[index].isFinal) finalText += piece
        else interimText += piece
      }
      const spoken = `${finalText} ${interimText}`.replace(/\s+/g, ' ').trim()
      setDraftAnswer([speechBaseRef.current, spoken].filter(Boolean).join(' ').slice(0, 5000))
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setError('Allow the microphone to dictate your answer.')
      }
      setIsListening(false)
    }
    recognition.onend = () => setIsListening(false)
    recognitionRef.current = recognition
    setError('')
    setIsListening(true)
    try {
      recognition.start()
    } catch {
      setIsListening(false)
      setError('Voice input could not start.')
    }
  }

  const canStart = Boolean(resumeData)

  const resumeSummary = useMemo(() => {
    if (!resumeData) {
      return null
    }

    return {
      skills: resumeData.skills.slice(0, 4),
      experienceCount: resumeData.experience_entries.length,
      projectCount: resumeData.project_entries.length,
    }
  }, [resumeData])

  const handleStart = async () => {
    if (!resumeData || busyRef.current) return
    busyRef.current = true
    const operation = ++operationRef.current
    try {
      setError('')
      setFeedback(null)
      setFinalResult(null)
      setPendingNextQuestion(null)
      setSubmittedAnswer('')
      stopListening()
      setIsLoading(true)

      const firstQuestion = await startInterview(jobId, resumeData, { mode, question_count: questionCount })
      if (operation !== operationRef.current) return
      setSessionToken(firstQuestion.session_token ?? null)

      setHasStarted(true)
      setSessionId(firstQuestion.session_id)
      setCurrentQuestion(firstQuestion)
      setDraftAnswer('')
    } catch (err) {
      if (operation !== operationRef.current) return
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unable to start the interview right now.')
      }
    } finally {
      if (operation === operationRef.current) {
        busyRef.current = false
        setIsLoading(false)
      }
    }
  }

  const handleSubmit = async () => {
    if (busyRef.current || !sessionId || !currentQuestion || !draftAnswer.trim()) {
      return
    }

    busyRef.current = true
    const operation = ++operationRef.current
    try {
      setError('')
      setIsSubmitting(true)
      stopListening()

      const answer = draftAnswer.trim()
      const result = await submitInterviewAnswer(sessionId, answer, currentQuestion.question_id, sessionToken)
      if (operation !== operationRef.current) return

      setSubmittedAnswer(answer)
      setFeedback(result.feedback)
      setDraftAnswer('')

      if (result.is_complete) {
        setCurrentQuestion(null)
        setPendingNextQuestion(null)
        setFinalResult(result.final_result)
      } else {
        setPendingNextQuestion(result.next_question)
      }
    } catch (err) {
      if (operation !== operationRef.current) return
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Unable to submit your answer.')
      }
    } finally {
      if (operation === operationRef.current) {
        busyRef.current = false
        setIsSubmitting(false)
      }
    }
  }

  const handleContinue = () => {
    if (!pendingNextQuestion) {
      return
    }

    setCurrentQuestion(pendingNextQuestion)
    setPendingNextQuestion(null)
    setFeedback(null)
    setSubmittedAnswer('')
    stopListening()
  }

  const handleRestart = () => {
    operationRef.current += 1
    busyRef.current = false
    setIsLoading(false)
    setIsSubmitting(false)
    setSessionToken(null)
    setHasStarted(false)
    setSessionId(null)
    setCurrentQuestion(null)
    setDraftAnswer('')
    setSubmittedAnswer('')
    setFeedback(null)
    stopListening()
    setPendingNextQuestion(null)
    setFinalResult(null)
    setError('')
  }

  useEffect(() => {
    handleRestart()
    return () => { operationRef.current += 1; recognitionRef.current?.stop() }
    // Reset when switching jobs or replacing the resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, resumeData])

  return (
    <div className={styles.panel}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <div className={styles.eyebrow}>HireSense Interview Lab</div>
          <h3 className={styles.title}>AI Interview Prep</h3>
          <p className={styles.sub}>
            Interview questions are generated from this job and your uploaded resume.
          </p>
        </div>

        {currentQuestion && (
          <div className={styles.progressPill}>
            Q{currentQuestion.question_index}/{currentQuestion.total_questions}
          </div>
        )}
      </div>

      {!canStart ? (
        <div className={styles.emptyCard}>
          Upload a resume first to unlock a personalized interview for <strong>{jobTitle}</strong>.
        </div>
      ) : !hasStarted ? (
        <div className={styles.startCard}>
          <div className={styles.startHeadline}>
            Start a job-specific interview for {jobTitle} at {company}
          </div>

          <div className={styles.startText}>
            HireSense will generate role-aware questions using your resume, the job’s required skills,
            and the job description context.
          </div>

          {resumeSummary && (
            <div className={styles.resumeLockup}>
              Resume signal ready • {resumeSummary.skills.length} highlighted skills •{' '}
              {resumeSummary.experienceCount} experience entries • {resumeSummary.projectCount} projects
            </div>
          )}

          <div className={styles.optionsRow}>
            <label>Interview mode
              <select value={mode} disabled={isLoading} onChange={(e) => setMode(e.target.value as InterviewMode)}>
                <option value="mixed">Mixed</option>
                <option value="behavioral">Behavioral</option>
                <option value="technical">Technical</option>
                <option value="role_specific">Role specific</option>
              </select>
            </label>
            <label>Core questions
              <select value={questionCount} disabled={isLoading} onChange={(e) => setQuestionCount(Number(e.target.value) as 3 | 5 | 8)}>
                <option value={3}>3</option><option value={5}>5</option><option value={8}>8</option>
              </select>
            </label>
          </div>
          <p className={styles.sub}>Up to two follow-up questions may be added based on your answers.</p>
          <div className={styles.actionRow}>
            <button className="btn-primary" onClick={() => void handleStart()} disabled={isLoading}>
              {isLoading ? 'Generating...' : 'Start Interview'}
            </button>
          </div>

          {error && <div role="alert" className={styles.errorText}>{error}</div>}
        </div>
      ) : finalResult ? (
        <div className={styles.resultsCard}>
          <div className={styles.resultsLabel}>Final Interview Results</div>
          <div className={`${styles.finalScore} ${scoreTone(finalResult.final_score)}`}>{finalResult.final_score}/100</div>
          <div className={styles.resultsSummary}>{finalResult.overall_summary}</div>
          <p className={styles.sub}>{finalResult.source === 'ai' ? 'AI assisted debrief' : 'Guided practice debrief'} • Practice scores are coaching signals.</p>
          {finalResult.technical_signals && <p>{finalResult.technical_signals}</p>}
          {finalResult.communication_signals && <p>{finalResult.communication_signals}</p>}
          {finalResult.resume_evidence?.length ? <div><strong>Resume context</strong><ul>{finalResult.resume_evidence.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null}
          {finalResult.strongest_questions?.length ? <div><strong>Strongest answers</strong><ul>{finalResult.strongest_questions.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null}
          {finalResult.practice_questions?.length ? <div><strong>Practice next</strong><ul>{finalResult.practice_questions.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : null}
          <DimensionList dimensions={finalResult.dimensions} />

          <div className={styles.resultsGrid}>
            <div>
              <div className={styles.feedbackSectionTitle}>Top Strengths</div>
              <ul className={styles.feedbackList}>
                {finalResult.top_strengths.length > 0 ? (
                  finalResult.top_strengths.map((item) => <li key={item}>{item}</li>)
                ) : (
                  <li>Strongest signals will appear here after more responses.</li>
                )}
              </ul>
            </div>

            <div>
              <div className={styles.feedbackSectionTitle}>Next Steps</div>
              <ul className={styles.feedbackList}>
                {finalResult.next_steps.length > 0 ? (
                  finalResult.next_steps.map((item) => <li key={item}>{item}</li>)
                ) : (
                  <li>Continue refining your answers with more concrete, role-specific detail.</li>
                )}
              </ul>
            </div>
          </div>

          <div className={styles.actionRow}>
            <button className="btn-outline" onClick={handleRestart}>
              Start New Interview
            </button>
          </div>
        </div>
      ) : (
        <>
          {currentQuestion && (
            <div className={styles.questionCard}>
              <div className={styles.questionLabel}>{currentQuestion.is_follow_up ? 'Follow-up Question' : 'Current Question'}</div>
              <p className={styles.sub}>{currentQuestion.source === 'ai' ? 'AI generated question' : 'Guided practice question'}</p>
              <div className={styles.focusArea}>{currentQuestion.focus_area}</div>
              <div className={styles.questionPrompt}>{currentQuestion.prompt}</div>

              {currentQuestion.tips.length > 0 && (
                <ul className={styles.tipList}>
                  {currentQuestion.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {submittedAnswer && (
            <div className={styles.startCard}>
              <div className={styles.questionLabel}>Your Answer</div>
              <p className={styles.submittedAnswer}>{submittedAnswer}</p>
            </div>
          )}

          {feedback && (
            <div className={styles.feedbackCard}>
              <div className={styles.feedbackLabel}>Feedback</div>

              <div className={styles.feedbackTopRow}>
                <div className={`${styles.scoreBadge} ${scoreTone(feedback.score)}`}>{feedback.score}/100</div>
                <div className={styles.benchmark}>{feedback.benchmark}</div>
              </div>

              <div className={styles.summary}>{feedback.summary}</div>
              <p className={styles.sub}>{feedback.source === 'ai' ? 'AI assisted feedback' : 'Heuristic practice feedback'}</p>
              {feedback.technical_depth && <p>{feedback.technical_depth}</p>}
              {feedback.communication && <p>{feedback.communication}</p>}
              {feedback.role_relevance && <p>{feedback.role_relevance}</p>}
              {feedback.suggested_approach && <p><strong>Suggested approach:</strong> {feedback.suggested_approach}</p>}
              {feedback.evidence?.length ? <ul>{feedback.evidence.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
              <DimensionList dimensions={feedback.dimensions} />

              <div className={styles.feedbackGrid}>
                <div>
                  <div className={styles.feedbackSectionTitle}>Strengths</div>
                  <ul className={styles.feedbackList}>
                    {feedback.strengths.length > 0 ? (
                      feedback.strengths.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>No strengths were captured for this answer.</li>
                    )}
                  </ul>
                </div>

                <div>
                  <div className={styles.feedbackSectionTitle}>Improvements</div>
                  <ul className={styles.feedbackList}>
                    {feedback.improvements.length > 0 ? (
                      feedback.improvements.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>No improvements were suggested for this answer.</li>
                    )}
                  </ul>
                </div>
              </div>

              {pendingNextQuestion && (
                <div className={styles.actionRow}>
                  <button className="btn-primary" onClick={handleContinue}>
                    Continue to Next Question
                  </button>
                </div>
              )}
            </div>
          )}

          {currentQuestion && !feedback && (
            <div className={styles.startCard}>
              <div className={styles.answerHeader}>
                <div className={styles.questionLabel}>Your Answer</div>
                <button
                  type="button"
                  className={`${styles.micButton} ${isListening ? styles.micListening : ''}`}
                  aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                  aria-pressed={isListening}
                  title={speechSupported ? 'Speak your answer' : 'Voice input is not available in this browser'}
                  onClick={toggleListening}
                  disabled={isSubmitting || !speechSupported}
                >
                  <MicIcon />
                </button>
              </div>
              <textarea
                className={styles.answerBox}
                aria-label="Interview answer"
                maxLength={5000}
                disabled={isSubmitting}
                placeholder="Write your answer here. Use a clear problem → action → result structure when possible."
                value={draftAnswer}
                onChange={(e) => setDraftAnswer(e.target.value)}
              />

              <div className={styles.actionRow}>
                <button
                  className="btn-primary"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting || draftAnswer.trim().length === 0}
                >
                  {isSubmitting ? 'Scoring Answer...' : 'Submit Answer'}
                </button>

                <button className="btn-outline" onClick={handleRestart} disabled={isSubmitting}>
                  Restart
                </button>
              </div>

              {error && <div role="alert" className={styles.errorText}>{error}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}