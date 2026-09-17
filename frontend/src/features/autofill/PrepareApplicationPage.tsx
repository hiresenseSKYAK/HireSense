import { Link, useNavigate } from 'react-router-dom'
import type { ApplicantProfile } from './core/types'
import { getResumeAnalysis } from '../../utils/resumeStorage'
import ProfileReview from './ProfileReview'
import { hasUsableResumeAnalysis } from './review'
import styles from './ProfileReview.module.css'

export default function PrepareApplicationPage() {
  const navigate = useNavigate()
  const resume = getResumeAnalysis()

  const handleContinue = (profile: ApplicantProfile) => {
    navigate('/application/demo', { state: { profile } })
  }

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
          Review the details from your uploaded resume before the next autofill step.
        </p>
      </div>
      <ProfileReview resume={resume} onContinue={handleContinue} />
    </div>
  )
}
