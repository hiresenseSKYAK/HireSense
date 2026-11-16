import client from './client'
import type { AuthResponse } from '../types'
import { clearResumeAnalysis } from '../utils/resumeStorage'
import { clearAutofillProfileData } from '../features/autofill/readiness'

const AUTH_STORAGE_KEY = 'hiresense_auth_session'

export type StoredAuthSession = AuthResponse

export const signup = async (
  username: string,
  email: string,
  password: string,
): Promise<AuthResponse> => {
  const res = await client.post<AuthResponse>('/auth/signup', { username, email, password })
  saveAuthSession(res.data)
  return res.data
}

export const login = async (
  email: string,
  password: string,
): Promise<AuthResponse> => {
  const res = await client.post<AuthResponse>('/auth/login', { email, password })
  saveAuthSession(res.data)
  return res.data
}

export const logout = async (token?: string): Promise<void> => {
  const session = getAuthSession()
  const resolvedToken = token || session?.token

  try {
    if (resolvedToken) {
      await client.post('/auth/logout', null, { params: { token: resolvedToken } })
    }
  } finally {
    clearAuthSession()
  }
}

export function saveAuthSession(session: AuthResponse): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
}

export function getAuthSession(): StoredAuthSession | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredAuthSession
  } catch (error) {
    console.error('Failed to parse auth session:', error)
    localStorage.removeItem(AUTH_STORAGE_KEY)
    return null
  }
}

export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY)
  localStorage.removeItem('mock_auth')
  // The saved resume analysis holds personal details; don't leave it behind on a shared computer.
  clearResumeAnalysis()
  clearAutofillProfileData()
}

export function isAuthenticated(): boolean {
  return getAuthSession() !== null
}