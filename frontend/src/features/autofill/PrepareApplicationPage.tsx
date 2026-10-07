import { Link, useLocation } from 'react-router-dom'
import { getResumeAnalysis } from '../../utils/resumeStorage'
import ProfileReview from './ProfileReview'
import { hasUsableResumeAnalysis, isApplicantProfile } from './review'
import styles from './ProfileReview.module.css'

export default function PrepareApplicationPage() {
  const location = useLocation()
  const draft = (location.state as { draftProfile?: unknown } | null)?.draftProfile
  const resume = getResumeAnalysis()

  if (!hasUsableResumeAnalysis(resume)) {
    return (
      <div className="page">
        <section className={styles.emptyCard} aria-labelledby="prepare-application-title">
          <p className={styles.eyebrow}>Application preparation</p>
          <h1 id="prepare-application-title" className={styles.emptyTitle}>
            Prepare your applicant profile
          </h1>
          <p className={styles.emptyMessage}>
            Upload a resume before preparing an application.
          </p>
          <a
            className={styles.storeLink}
            href="https://chromewebstore.google.com/detail/joikcoanlbhcleekjhgmbhaphhnhaiad?utm_source=item-share-cb"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get HireSense Autofill for Chrome
          </a>
          <Link to="/resume" className="btn-primary">
            Go to Resume Upload
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <div className={styles.pageHeader}>
        <Link to="/resume" className={styles.backLink}>
          ← Resume
        </Link>
        <h1 className={styles.pageTitle}>Prepare Application</h1>
        <p className={styles.pageSubtitle}>
          Review the details HireSense can fill. Blank fields stay blank.
        </p>
        <a
          className={styles.storeLink}
          href="https://chromewebstore.google.com/detail/joikcoanlbhcleekjhgmbhaphhnhaiad?utm_source=item-share-cb"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get HireSense Autofill for Chrome
        </a>
      </div>
      <ProfileReview resume={resume} draft={isApplicantProfile(draft) ? draft : undefined} />
    </div>
  )
}
