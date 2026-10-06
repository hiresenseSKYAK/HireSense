import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, signup } from '../api/auth'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const navigate = useNavigate()

  const [isSignup, setIsSignup] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img src="/logo.png" alt="HireSense" className={styles.logo} />
        <h1 className={styles.title}>{isSignup ? 'Create Account' : 'Welcome Back'}</h1>
        <p className={styles.sub}>
          {isSignup
            ? 'Create your HireSense account to unlock job matching and resume insights.'
            : 'Log in to continue managing your resume, matches, and job search progress.'}
        </p>

        <form onSubmit={(event) => void handleSubmit(event)}>
          {isSignup && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="username">Username</label>
              <input
                id="username"
                className={styles.input}
                type="text"
                autoComplete="username"
                required
                placeholder="anas"
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
              placeholder="you@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              className={styles.input}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', padding: '11px', justifyContent: 'center', marginTop: '4px' }}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? isSignup ? 'Creating account…' : 'Signing in…'
              : isSignup ? 'Create Account' : 'Log In'}
          </button>
        </form>

        <p className={styles.toggle}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            className={styles.toggleButton}
            onClick={() => {
              setIsSignup(!isSignup)
              setError('')
            }}
          >
            {isSignup ? 'Log In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}
