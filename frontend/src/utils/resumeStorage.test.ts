// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import type { ResumeUploadResponse } from '../api/resume'
import { getResumeAnalysis, saveResumeAnalysis } from './resumeStorage'

afterEach(() => localStorage.clear())

function signIn(id: number) {
  localStorage.setItem('hiresense_auth_session', JSON.stringify({ token: 'fixture', user: { id } }))
}

it('keeps a saved resume within the account that uploaded it', () => {
  signIn(11)
  saveResumeAnalysis({ parsed_data: { skills: ['Python'] } } as ResumeUploadResponse)
  expect(getResumeAnalysis()?.parsed_data.skills).toEqual(['Python'])
  signIn(12)
  expect(getResumeAnalysis()).toBeNull()
})

it('binds a legacy or guest resume when first used by an account', () => {
  localStorage.setItem('hiresense_resume_analysis', JSON.stringify({ parsed_data: { skills: ['SQL'] } }))
  signIn(11)
  expect(getResumeAnalysis()?.parsed_data.skills).toEqual(['SQL'])
  signIn(12)
  expect(getResumeAnalysis()).toBeNull()
})
