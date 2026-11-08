import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCheck, IconUpload, IconX } from '../components/Icons'
import {
  deleteSavedResume,
  uploadResume,
  type ParsedResumeData,
  type ResumeUploadResponse,
  type StructuredResumeEntry,
} from '../api/resume'
import {
  clearResumeAnalysis,
  restoreSavedResume,
  saveResumeAnalysis,
} from '../utils/resumeStorage'
import styles from './ResumePage.module.css'
import ResumeCoachPanel from '../components/ResumeCoachPanel'

function StructuredEntrySection({
  title,
  entries,
  emptyText,
}: {
  title: string
  entries: StructuredResumeEntry[]
  emptyText: string
}) {
  return (
    <section className={styles.sectionCard}>
      <div className={styles.analysisSectionTitle}>{title}</div>

      {entries.length > 0 ? (
        <div className={styles.entryGroupList}>
          {entries.map((entry, index) => (
            <div key={`${entry.title}-${index}`} className={styles.entryCard}>
              <div className={styles.entryTitleCard}>
                <div className={styles.entryTitle}>{entry.title}</div>
              </div>

              {entry.bullets.length > 0 && (
                <ul className={styles.entryBullets}>
                  {entry.bullets.map((bullet, bulletIndex) => (
                    <li
                      key={`${entry.title}-${bulletIndex}`}
                      className={styles.entryBulletCard}
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyMini}>{emptyText}</div>
      )}
    </section>
  )
}

function AnalysisList({
  title,
  items,
  icon,
  tone,
  emptyText,
}: {
  title: string
  items: string[]
  icon: React.ReactNode
  tone: 'pos' | 'warn' | 'neg'
  emptyText: string
}) {
  return (
    <section className={styles.sectionCard}>
      <div className={styles.analysisSectionTitle}>{title}</div>

      {items.length > 0 ? (
        <ul className={styles.insightList}>
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className={styles.insightItem}>
              <span className={`${styles.insightIcon} ${styles[tone]}`}>{icon}</span>
              <span className={styles.insightText}>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.emptyMini}>{emptyText}</div>
      )}
    </section>
  )
}

// Older saved resumes only have "name"; split it the same way the autofill profile does.
function resumeNames(parsed: ParsedResumeData): { first: string; last: string } {
  const first = parsed.first_name?.trim() ?? ''
  const last = parsed.last_name?.trim() ?? ''
  if (first || last) return { first, last }
  const words = (parsed.name ?? '').trim().split(/\s+/).filter(Boolean)
  return { first: words[0] ?? '', last: words.length > 1 ? words[words.length - 1] : '' }
}

function InfoItem({ label, value, link = false }: { label: string; value?: string | null; link?: boolean }) {
  const text = value?.trim() ?? ''
  return (
    <div className={styles.infoItem}>
      <span className={styles.infoLabel}>{label}</span>
      {!text ? (
        <span className={`${styles.infoValue} ${styles.infoMissing}`}>Not found</span>
      ) : link && /^https:\/\//.test(text) ? (
        <a className={`${styles.infoValue} ${styles.infoLink}`} href={text} target="_blank" rel="noopener noreferrer">
          {text.replace(/^https:\/\/(www\.)?/, '')}
        </a>
      ) : (
        <span className={styles.infoValue}>{text}</span>
      )}
    </div>
  )
}

function educationDates(entry: { startDate?: string; endDate?: string; current?: boolean }): string {
  const year = (date?: string) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : '')
  const start = year(entry.startDate)
  const end = entry.current ? 'Present' : year(entry.endDate)
  return start && end ? `${start} – ${end}` : end || start
}

function EducationSection({ resume }: { resume: ResumeUploadResponse }) {
  const structured = (resume.applicant_profile?.education ?? []).filter((entry) => entry.school || entry.degree || entry.fieldOfStudy)
  if (structured.length === 0) {
    return (
      <StructuredEntrySection
        title="Education"
        entries={(resume.parsed_data.education || []).map((item) => ({ title: item, bullets: [] }))}
        emptyText="No education found."
      />
    )
  }
  return (
    <section className={styles.sectionCard}>
      <div className={styles.analysisSectionTitle}>Education</div>
      <div className={styles.entryGroupList}>
        {structured.map((entry, index) => {
          const degree = [entry.degree, entry.fieldOfStudy].filter(Boolean).join(' in ')
          const dates = educationDates(entry)
          return (
            <div key={`${entry.school}-${index}`} className={styles.entryCard}>
              <div className={styles.entryTitleCard}>
                <div className={styles.entryTitle}>{entry.school || 'School not found'}</div>
              </div>
              {(degree || dates) && (
                <div className={styles.educationMeta}>
                  {degree && <span>{degree}</span>}
                  {dates && <span>{dates}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function ResumePage() {
  const navigate = useNavigate()
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [uploadedAt, setUploadedAt] = useState('')
  const [error, setError] = useState('')
  const [resumeResult, setResumeResult] = useState<ResumeUploadResponse | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [isRemoving, setIsRemoving] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    // Uses this browser's copy, or loads the one saved on the account (for example after logging back in).
    void restoreSavedResume().then((savedResume) => {
      if (cancelled) return
      if (savedResume) {
        setResumeResult(savedResume)
        setSelectedFileName(savedResume.filename || 'Previously uploaded resume')
        setUploadedAt(savedResume.saved_at
          ? new Date(savedResume.saved_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : 'saved locally')
      }
      setIsRestoring(false)
    })
    return () => { cancelled = true }
  }, [])

  const handleRemove = async () => {
    if (isRemoving || !window.confirm('Remove this resume from HireSense? You can upload it again at any time.')) return
    try {
      setIsRemoving(true)
      setError('')
      await deleteSavedResume()
      clearResumeAnalysis()
      setResumeResult(null)
      setSelectedFileName('')
      setUploadedAt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove your saved resume. Try again.')
    } finally {
      setIsRemoving(false)
    }
  }

  const isAllowedFile = (file: File) => {
    const fileName = file.name.toLowerCase()
    return fileName.endsWith('.pdf') || fileName.endsWith('.docx')
  }

  const validateFile = (file: File) => {
    if (!isAllowedFile(file)) {
      return 'Only PDF and DOCX files are allowed.'
    }

    if (file.size === 0) {
      return 'The selected file is empty.'
    }

    if (file.size > 5 * 1024 * 1024) {
      return 'File is too large. Please upload a resume smaller than 5 MB.'
    }

    return ''
  }

  const formatTime = () => {
    return new Date().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'var(--green)'
    if (score >= 70) return 'var(--amber)'
    return 'var(--red)'
  }

  const getScoreLabel = (score: number) => {
    if (score >= 85) return 'Strong'
    if (score >= 70) return 'Good'
    if (score >= 55) return 'Needs Work'
    return 'Weak'
  }

  const getScoreGradient = (score: number) => {
    const color = getScoreColor(score)
    return {
      background: `conic-gradient(${color} 0% ${score}%, var(--border) ${score}% 100%)`,
    }
  }

  const handleFileUpload = async (file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    const previousFileName = selectedFileName
    try {
      setError('')
      setIsUploading(true)
      setSelectedFileName(file.name)

      const result = await uploadResume(file)
      setResumeResult(result)
      saveResumeAnalysis(result)
      setUploadedAt(formatTime())
    } catch (err) {
      // A failed replacement keeps the resume that was already saved.
      setSelectedFileName(previousFileName)
      const message = err instanceof Error ? err.message : 'Something went wrong while uploading the resume.'
      setError(resumeResult ? `${message} Your previous resume is still saved.` : message)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isUploading) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    if (isUploading) return

    const file = e.dataTransfer.files?.[0]
    if (file) {
      void handleFileUpload(file)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) {
      void handleFileUpload(file)
    }
  }

  const parsed = resumeResult?.parsed_data
  const analysis = resumeResult?.analysis
  const priorityFixes = analysis?.improvements.slice(0, 3) ?? []
  const contactNames = parsed ? resumeNames(parsed) : { first: '', last: '' }

  return (
    <div className="page">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx"
        className={styles.hiddenInput}
        onChange={handleFileChange}
        disabled={isUploading}
      />
      <div className={resumeResult ? styles.savedLayout : styles.layout}>
        {!resumeResult ? (
          <div
            className={`${styles.uploadBox} ${isDragging ? styles.dragging : ''} ${
              isUploading ? styles.uploading : ''
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
              if (!isUploading) fileInputRef.current?.click()
            }}
          >
            <div className={styles.uploadIcon}>
              <IconUpload />
            </div>

            <h3 className={styles.uploadTitle}>
              {isUploading ? 'Analyzing your resume...' : isRestoring ? 'Checking for your saved resume...' : 'Drop your resume here'}
            </h3>
            <p className={styles.uploadSub}>
              {isUploading
                ? 'We are extracting content, grading it, and generating recommendations.'
                : 'or click to browse your files. Your analysis is saved to your account.'}
            </p>

            <button
              className="btn-primary"
              style={{ padding: '10px 24px' }}
              onClick={(e) => {
                e.stopPropagation()
                if (!isUploading) fileInputRef.current?.click()
              }}
              disabled={isUploading}
            >
              {isUploading ? 'Processing...' : 'Choose File'}
            </button>

            <div className={styles.uploadFormats}>Supports PDF and DOCX • Max size 5 MB</div>

            {error && (
              <div className={`${styles.statusMessage} ${styles.errorState}`}>{error}</div>
            )}
          </div>
        ) : (
          <div
            className={`${styles.savedBar} ${isDragging ? styles.savedBarDragging : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className={styles.recentFile}>
              <div className={styles.recentFileBadge}>CV</div>
              <div className={styles.recentFileInfo}>
                <div className={styles.recentFileName}>
                  {selectedFileName || resumeResult.filename}
                </div>
                <div className={styles.recentFileMeta}>
                  {isUploading
                    ? 'Analyzing your resume...'
                    : isDragging
                      ? 'Drop to replace this resume'
                      : `Uploaded ${uploadedAt || 'just now'} · drop a new file here to replace it`}
                </div>
              </div>
              <div className={styles.recentFileStatus}>{isUploading ? 'Processing' : 'Processed'}</div>
            </div>
            <div className={styles.recentActions}>
              {parsed && analysis && (
                <button
                  className="btn-primary"
                  onClick={() => navigate('/application/prepare')}
                  disabled={isUploading}
                >
                  Prepare Application
                </button>
              )}
              <button
                className={styles.secondaryButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isRemoving}
              >
                Replace
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => void handleRemove()}
                disabled={isUploading || isRemoving}
              >
                {isRemoving ? 'Removing...' : 'Remove'}
              </button>
            </div>
            {error && (
              <div className={`${styles.statusMessage} ${styles.errorState}`}>{error}</div>
            )}
          </div>
        )}

        <div className={styles.analysisCard}>
          <h2 className={styles.analysisTitle}>Resume Analysis</h2>

          {!resumeResult || !parsed || !analysis ? (
            <div className={styles.emptyState}>
              Upload a resume to see your score, parsed sections, major warnings, and
              targeted improvement suggestions.
            </div>
          ) : (
            <div className={styles.analysisContent}>
              <div className={styles.scoreWrap}>
                <div className={styles.scoreRing} style={getScoreGradient(analysis.score)}>
                  <span className={styles.scoreNum}>
                    {analysis.score}
                  </span>
                </div>

                <div className={styles.scoreMeta}>
                  <div className={styles.scoreTopRow}>
                    <div className={styles.scoreLabel}>Overall Resume Score</div>
                    <span className={styles.scoreBadge}>{getScoreLabel(analysis.score)}</span>
                  </div>
                  <div className={styles.scoreSub}>{analysis.summary}</div>
                </div>
              </div>

              {priorityFixes.length > 0 && (
                <section className={styles.sectionCard}>
                  <div className={styles.analysisSectionTitle}>Priority Fixes</div>
                  <div className={styles.priorityFixGrid}>
                    {priorityFixes.map((fix, index) => (
                      <div key={`${fix}-${index}`} className={styles.priorityFixCard}>
                        <div className={styles.priorityFixLabel}>
                          {index === 0 ? 'High Priority' : index === 1 ? 'Quick Win' : 'Improve Next'}
                        </div>
                        <div className={styles.priorityFixText}>{fix}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className={styles.snapshotGrid}>
                <div className={styles.snapshotCard}>
                  <div className={styles.snapshotValue}>{parsed.skills.length}</div>
                  <div className={styles.snapshotLabel}>Skills Found</div>
                </div>
                <div className={styles.snapshotCard}>
                  <div className={styles.snapshotValue}>{parsed.experience_entries.length}</div>
                  <div className={styles.snapshotLabel}>Experience Entries</div>
                </div>
                <div className={styles.snapshotCard}>
                  <div className={styles.snapshotValue}>{parsed.project_entries.length}</div>
                  <div className={styles.snapshotLabel}>Project Entries</div>
                </div>
                <div className={styles.snapshotCard}>
                  <div className={styles.snapshotValue}>{analysis.warnings.length}</div>
                  <div className={styles.snapshotLabel}>Major Warnings</div>
                </div>
              </div>

              <ResumeCoachPanel resume={parsed} />

              <section className={styles.sectionCard}>
                <div className={styles.analysisSectionTitle}>Contact Information</div>
                <div className={styles.infoGrid}>
                  <InfoItem label="First name" value={contactNames.first} />
                  <InfoItem label="Last name" value={contactNames.last} />
                  <InfoItem label="Email" value={parsed.email} />
                  <InfoItem label="Phone" value={parsed.phone} />
                  <InfoItem label="City / State" value={[parsed.city, parsed.state].filter(Boolean).join(', ')} />
                  <InfoItem label="LinkedIn" value={parsed.linkedin} link />
                  <InfoItem label="GitHub" value={parsed.github} link />
                </div>
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.analysisSectionTitle}>Skills Found</div>
                {parsed.skills.length > 0 ? (
                  <div className={styles.tagsWrap}>
                    {parsed.skills.map((skill, index) => (
                      <span key={`${skill}-${index}`} className={styles.tag}>
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyMini}>No skills found.</div>
                )}
              </section>

              <EducationSection resume={resumeResult} />

              <StructuredEntrySection
                title="Experience"
                entries={parsed.experience_entries || []}
                emptyText="No experience found."
              />

              <StructuredEntrySection
                title="Projects"
                entries={parsed.project_entries || []}
                emptyText="No projects found."
              />

              <StructuredEntrySection
                title="Leadership / Professional Development"
                entries={parsed.leadership_entries || []}
                emptyText="No leadership entries found."
              />

              <div className={styles.threeColumnGrid}>
                <AnalysisList
                  title="Strengths"
                  items={analysis.strengths}
                  icon={<IconCheck />}
                  tone="pos"
                  emptyText="No strengths found."
                />

                <AnalysisList
                  title="Warnings"
                  items={analysis.warnings}
                  icon={<IconX />}
                  tone="neg"
                  emptyText="No major warnings found."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
