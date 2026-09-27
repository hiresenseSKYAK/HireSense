import { describe, expect, it } from 'vitest'
import { matchResumeToJob } from './jobMatcher'

describe('resume-to-job matching', () => {
  it('uses exact skill overlap without artificial score floors', () => {
    const result = matchResumeToJob(
      { skills: ['Python', 'React', 'Git'] },
      { tags: ['Python', 'React', 'Git', 'SQL', 'AWS', 'Docker', 'Java', 'TypeScript', 'Kubernetes', 'Linux'] },
    )
    expect(result.matchScore).toBe(30)
    expect(result.matchedSkills).toHaveLength(3)
  })

  it('returns no match signal when the job has no usable skills', () => {
    const result = matchResumeToJob({ skills: ['Python'] }, { title: 'Opportunity' })
    expect(result.matchScore).toBe(0)
    expect(result.matchedSkills).toEqual([])
    expect(result.missingSkills).toEqual([])
  })

  it('does not award 100 percent from one overlapping skill', () => {
    const result = matchResumeToJob(
      { skills: ['Python'] },
      { title: 'Software Engineer', tags: ['Python'] },
    )
    expect(result.matchedSkills).toEqual(['Python'])
    expect(result.matchScore).toBe(25)
  })
})
