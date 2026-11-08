import { useState } from 'react'
import styles from './ProfileReview.module.css'

// The extension rejects skills longer than this (see bridgeContract.ts).
const MAX_SKILL_LENGTH = 60

/** Type a skill and press Enter or comma to add it; each skill shows as a removable tag. */
export default function SkillTagInput({
  skills,
  max,
  disabled,
  onChange,
}: {
  skills: string[]
  max: number
  disabled: boolean
  onChange: (skills: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const atLimit = skills.length >= max

  const addSkills = (text: string) => {
    const next = [...skills]
    let duplicate = ''
    for (const part of text.split(',')) {
      const skill = part.trim().slice(0, MAX_SKILL_LENGTH)
      if (!skill) continue
      if (next.some((existing) => existing.toLowerCase() === skill.toLowerCase())) {
        duplicate = skill
        continue
      }
      if (next.length >= max) break
      next.push(skill)
    }
    setDraft('')
    setNotice(duplicate ? `"${duplicate}" is already in your list.` : next.length >= max ? `You've reached the ${max}-skill limit.` : '')
    if (next.length !== skills.length) onChange(next)
  }

  return (
    <div className={styles.tagInput}>
      {skills.length > 0 && (
        <ul className={styles.tagList} aria-label="Your skills">
          {skills.map((skill) => (
            <li key={skill.toLowerCase()} className={styles.tag}>
              <span>{skill}</span>
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`Remove ${skill}`}
                disabled={disabled}
                onClick={() => { setNotice(''); onChange(skills.filter((item) => item !== skill)) }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Add a skill
          <span className={styles.origin}>{skills.length} of {max}</span>
        </span>
        <input
          className={styles.input}
          value={draft}
          maxLength={MAX_SKILL_LENGTH * 4}
          disabled={disabled || atLimit}
          placeholder={atLimit ? 'Skill limit reached' : 'Type a skill and press Enter'}
          onChange={(event) => {
            const value = event.target.value
            // Typing or pasting a comma adds everything before it.
            if (value.includes(',')) addSkills(value)
            else setDraft(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addSkills(draft)
            }
          }}
          onBlur={() => { if (draft.trim()) addSkills(draft) }}
        />
      </label>
      {notice && <p className={styles.confirmationHint} role="status">{notice}</p>}
    </div>
  )
}
