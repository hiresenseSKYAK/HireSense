import styles from './ProfileReview.module.css'

export default function AutofillSteps({ step }: { step: 1 | 2 | 3 }) {
  return <ol className={styles.steps} aria-label="Application preparation progress">
    {['Upload resume', 'Review & confirm', 'Preview & prepare', 'Review & submit yourself'].map((label, index) =>
      <li key={label} aria-current={index === step ? 'step' : undefined} className={index < step ? styles.completedStep : ''}>
        <span aria-hidden="true">{index < step ? '✓' : index + 1}</span>{label}
      </li>)}
  </ol>
}
