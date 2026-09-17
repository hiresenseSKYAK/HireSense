import styles from './PrivacyPage.module.css'

const policy = [
  'HireSense Autofill uses applicant information that the user has reviewed and confirmed in HireSense to help fill supported job application fields.',
  'This information may include personally identifiable information such as name, email address, phone number, address, professional profile links, and resume information.',
  'The extension may also inspect job application page content, such as field labels and form structure, only to determine which supported fields can be safely filled.',
  'HireSense Autofill does not sell user data, does not use user data for advertising, and does not transfer user data for purposes unrelated to the extension’s autofill functionality.',
  'The extension does not collect passwords, payment information, health information, or personal communications.',
  'Applicant profile and resume information used by the extension is only used to perform the user-requested autofill workflow. The extension does not automatically submit job applications.',
  'Users remain in control of reviewing, editing, and submitting all application information.',
]

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <div className={styles.heading}>
          <p>Privacy</p>
          <h1>HireSense Autofill Privacy Policy</h1>
        </div>

        <div className={styles.policy}>
          {policy.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <p>Contact: <a href="mailto:anasharun2004@gmail.com">anasharun2004@gmail.com</a></p>
        </div>
      </article>
    </main>
  )
}
