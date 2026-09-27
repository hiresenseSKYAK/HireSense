import { Link } from 'react-router-dom'
import styles from './NotFoundPage.module.css'

export default function NotFoundPage() {
  return <div className="page">
    <section className={styles.card}>
      <p className={styles.eyebrow}>Page not found</p>
      <h1>Let’s get you back to the job search.</h1>
      <p>The page may have moved, or the link may no longer be valid.</p>
      <Link to="/" className="btn-primary">Browse live opportunities</Link>
    </section>
  </div>
}
