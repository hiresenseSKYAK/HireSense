import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { getAuthSession, logout } from '../api/auth'
import { clearAutofillProfileConfirmation } from '../features/autofill/readiness'
import styles from './Navbar.module.css'

function accountInitials(username?: string | null) {
  const parts = username?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return 'HS'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase()
}

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const session = getAuthSession()
  const username = session?.user.username
  const initials = accountInitials(username)

  useEffect(() => {
    if (!menuOpen) return

    const closeOnOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const handleLogout = async () => {
    setMenuOpen(false)
    clearAutofillProfileConfirmation()
    await logout(session?.token)
    navigate('/login')
  }

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.logo}>
          <img src="/logo.png" alt="HireSense" className={styles.logoImg} />
        </NavLink>
        <div className={styles.links}>
          <NavLink
            to="/resume"
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.active : ''}`
            }
          >
            Upload Resume
          </NavLink>
          <NavLink
            to="/application/prepare"
            className={`${styles.link} ${location.pathname.startsWith('/application/') ? styles.active : ''}`}
          >
            Application Autofill
          </NavLink>
          <div className={styles.account} ref={menuRef}>
            <button
              type="button"
              className={`${styles.avatar} ${location.pathname === '/profile' ? styles.avatarActive : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={username ? `Account menu for ${username}` : 'Account menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {initials}
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button type="button" className={styles.menuItem} role="menuitem" onClick={() => navigate('/profile')}>
                  Profile
                </button>
                <button type="button" className={styles.menuItem} role="menuitem" onClick={() => void handleLogout()}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
