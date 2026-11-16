import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { login, signup } from '../api/auth'
import { restoreSavedResume } from '../utils/resumeStorage'
import styles from './LoginPage.module.css'

type Mode = 'login' | 'signup'

const HIGHLIGHTS = [
  {
    title: 'Fresh, open roles',
    body: 'Listings are crawled from employer boards and checked so closed postings stay out of your feed.',
  },
  {
    title: 'Resume-aware matching',
    body: 'Upload your resume once and see how each role lines up with your skills.',
  },
  {
    title: 'Practice before you apply',
    body: 'Run an AI mock interview tailored to the job you are targeting.',
  },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'signup' ? 'signup' : 'login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSignup = mode === 'signup'

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setError('')
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    setError('')

    if (!email.trim() || !password.trim() || (isSignup && !username.trim())) {
      setError('Please fill in all required fields.')
      return
    }

    try {
      setIsSubmitting(true)

      if (isSignup) {
        await signup(username.trim(), email.trim(), password)
        navigate('/')
        return
      }

      await login(email.trim(), password)
      // Bring back the resume saved on this account before any page reads it.
      await restoreSavedResume()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <aside className={styles.brandPanel} aria-hidden="true">
        <div className={styles.brandInner}>
          <div className={styles.brandLogo}>
            <span className={styles.logoMark}>H</span>
            HireSense
          </div>
          <h2 className={styles.brandHeadline}>
            Find roles that are actually open, and show up ready for them.
          </h2>
          <ul className={styles.highlights}>
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className={styles.highlight}>
                <span className={styles.check}>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className={styles.highlightTitle}>{item.title}</p>
                  <p className={styles.highlightBody}>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className={styles.formPanel}>
        <div className={styles.card}>
          <div className={styles.mobileLogo}>
            <span className={styles.logoMark}>H</span>
            HireSense
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Account">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignup}
              className={`${styles.tab} ${!isSignup ? styles.tabActive : ''}`}
              onClick={() => switchMode('login')}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignup}
              className={`${styles.tab} ${isSignup ? styles.tabActive : ''}`}
              onClick={() => switchMode('signup')}
            >
              Sign up
            </button>
          </div>

          <h1 className={styles.title}>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className={styles.sub}>
            {isSignup
              ? 'Get job matching, resume insights, and interview practice in one place.'
              : 'Log in to pick up where you left off.'}
          </p>

          <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
            {isSignup && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">Username</label>
                <input
                  id="username"
                  className={styles.input}
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="Choose a username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">Email</label>
              <input
                id="email"
                className={styles.input}
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">Password</label>
              <div className={styles.passwordWrap}>
                <input
                  id="password"
                  className={`${styles.input} ${styles.passwordInput}`}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isSignup ? 'Create a password' : 'Enter your password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  className={styles.reveal}
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className={styles.error} role="alert">{error}</p>}

            <button type="submit" className={`btn-primary ${styles.submit}`} disabled={isSubmitting}>
              {isSubmitting
                ? isSignup ? 'Creating account…' : 'Logging in…'
                : isSignup ? 'Create account' : 'Log in'}
            </button>
          </form>

          <p className={styles.toggle}>
            {isSignup ? 'Already have an account?' : 'New to HireSense?'}{' '}
            <button
              type="button"
              className={styles.toggleButton}
              onClick={() => switchMode(isSignup ? 'login' : 'signup')}
            >
              {isSignup ? 'Log in' : 'Create an account'}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
