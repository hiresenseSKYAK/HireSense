import { NavLink, useLocation } from 'react-router-dom'
import styles from './Navbar.module.css'

export default function Navbar() {
  const location = useLocation()
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
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.active : ''}`
            }
          >
            Profile
          </NavLink>
        </div>
      </div>
    </nav>
  )
}
