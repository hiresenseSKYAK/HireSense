import styles from './PrivacyPage.module.css'

const policy = [
  'HireSense Autofill uses applicant information that the user has reviewed and confirmed in HireSense to help fill supported job application fields.',
  'This information may include personally identifiable information such as name, email address, phone number, address, professional profile links, and resume information.',
  'The extension may also inspect job application page content, such as field labels and form structure, only to determine which supported fields can be safely filled.',
  'HireSense Autofill does not sell user data, does not use user data for advertising, and does not transfer user data for purposes unrelated to the extension’s autofill functionality.',
  'The extension does not collect passwords, payment information, health information, or personal communications.',
  'Applicant profile and resume information used by the extension is only used to perform the user-requested autofill workflow. The extension does not automatically submit job applications.',
  'Users remain in control of reviewing, editing, and submitting all application information.',
  'When a signed-in user uploads a resume on the HireSense website, the resume text may be sent to OpenAI to help read the name, location, education, and work history. Email addresses, phone numbers, and links are removed before sending, requests are made with OpenAI’s response storage turned off, and every value is checked against the resume before it is shown. If this step is unavailable, HireSense reads the resume with its own rules instead.',
  'When a signed-in user uploads a resume, the details HireSense reads from it (such as name, contact details, skills, education, and work history) and its resume score are saved to that user’s HireSense account, so they are still available after signing in again. The original resume file is not stored. Users can remove the saved resume at any time with Remove on the Resume page, and uploading a new resume replaces it.',
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
