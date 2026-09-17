import styles from './ControlledApplication.module.css'

const stateOptions = [
  ['', 'Select a state'],
  ['TX', 'Texas'],
  ['CA', 'California'],
  ['WA', 'Washington'],
]

export function ClassicApplication() {
  return (
    <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
      <section aria-label="Applicant details" className={styles.formSection}>
        <h3>Contact details</h3>
        <div className={styles.formGrid}>
          <label>Full name<input name="candidate_full_name" autoComplete="name" /></label>
          <label>Email address<input name="candidate_email" type="email" /></label>
          <label>Mobile number<input id="candidate-mobile" type="tel" /></label>
          <label>City<input name="city" defaultValue="Dallas" /></label>
          <label>State / Province
            <select name="state">
              {stateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>LinkedIn URL<input name="linkedin_url" type="url" /></label>
          <label>GitHub URL<input name="github_url" type="url" disabled /></label>
          <label>Portfolio website<input name="portfolio_website" type="url" /></label>
        </div>
      </section>
      <fieldset className={styles.formSection}>
        <legend>Professional references</legend>
        <label>Reference email<input name="reference_email" type="email" /></label>
      </fieldset>
      <section aria-label="Application questions" className={styles.formSection}>
        <h3>Application questions</h3>
        <label>Why are you interested in this role?<textarea name="interest" /></label>
        <label className={styles.checkLabel}><input type="checkbox" name="consent" /> I agree to the application declaration.</label>
        <input type="hidden" name="application_token" value="demo-token" />
      </section>
    </form>
  )
}

export function CompactApplication() {
  return (
    <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
      <fieldset className={styles.formSection}>
        <legend>Personal information</legend>
        <div className={styles.formGrid}>
          <label>Given name<input autoComplete="given-name" /></label>
          <label aria-label="Family name">Surname<input id="applicant-last-name" /></label>
          <label>Email<input id="contactEmail" type="email" /></label>
          <label>Telephone<input autoComplete="tel" type="tel" /></label>
          <label>State<select id="location-state">{stateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Website<input placeholder="Personal website" type="url" readOnly /></label>
        </div>
      </fieldset>
      <section aria-label="Work authorization" className={styles.formSection}>
        <h3>Eligibility</h3>
        <label>Are you authorized to work in the United States?<input name="work_authorization" /></label>
      </section>
      <section aria-label="Additional contact details" className={styles.formSection}>
        <h3>Additional contact details</h3>
        <label>Email<input name="contact_method" autoComplete="tel" placeholder="Mobile number" /></label>
      </section>
      <section aria-label="Emergency contact" className={styles.formSection}>
        <h3>Emergency contact</h3>
        <label>First name<input name="emergency_first_name" /></label>
      </section>
    </form>
  )
}
