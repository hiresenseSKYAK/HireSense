import json
import unittest
from datetime import date

from services.job_card import card_summary_line, internship_details, summary_source_hash

TODAY = date(2026, 11, 17)
DESCRIPTION = 'We build payment systems. ' * 30


def details(title, description, level='Internship', job_type='Internship'):
    return internship_details(title, description, level, job_type, today=TODAY)


class CardSummaryLineTests(unittest.TestCase):
    def summary(self, **values):
        return json.dumps({'overview': 'The intern supports the payments team. It is fun.', 'responsibilities': [],
                           'requirements': [], 'nice_to_have': [], **values})

    def test_uses_first_responsibility(self):
        line = card_summary_line(self.summary(responsibilities=['Build APIs in Go', 'Write tests']),
                                 summary_source_hash(DESCRIPTION), DESCRIPTION)
        self.assertEqual(line, 'Build APIs in Go')

    def test_falls_back_to_first_overview_sentence(self):
        line = card_summary_line(self.summary(), summary_source_hash(DESCRIPTION), DESCRIPTION)
        self.assertEqual(line, 'The intern supports the payments team.')

    def test_ignores_summary_of_an_older_description(self):
        line = card_summary_line(self.summary(responsibilities=['Build APIs in Go']),
                                 summary_source_hash('An older posting. ' * 30), DESCRIPTION)
        self.assertIsNone(line)

    def test_ignores_missing_rejected_or_unreadable_summaries(self):
        source_hash = summary_source_hash(DESCRIPTION)
        self.assertIsNone(card_summary_line(None, None, DESCRIPTION))
        self.assertIsNone(card_summary_line('null', source_hash, DESCRIPTION))
        self.assertIsNone(card_summary_line('{not json', source_hash, DESCRIPTION))

    def test_long_line_is_shortened_on_a_word(self):
        line = card_summary_line(self.summary(responsibilities=['Design ' * 60]),
                                 summary_source_hash(DESCRIPTION), DESCRIPTION)
        self.assertLessEqual(len(line), 181)
        self.assertTrue(line.endswith('…'))


class InternshipDetailsTests(unittest.TestCase):
    def test_full_details(self):
        text = """<ul><li>Expected to graduate between Fall 2027 and Summer 2028, and enrolled at an accredited college.</li>
        <li>Able to commit to a full-time, 12-week internship beginning in May/June 2027.</li></ul>"""
        self.assertEqual(details('Data Science Intern [Summer 2027]', text),
                         ['Summer 2027', '12 weeks', 'Graduating Fall 2027 – Summer 2028'])

    def test_only_for_internships(self):
        self.assertEqual(details('Engineer, Summer 2027', 'A 12-week internship.',
                                 level='Entry level', job_type='Full-time'), [])

    def test_graduation_terms_are_not_the_internship_term(self):
        text = 'Expected to graduate between Fall 2027 and Summer 2028.'
        self.assertEqual(details('Data Intern', text), ['Graduating Fall 2027 – Summer 2028'])

    def test_term_from_description_and_short_year(self):
        self.assertEqual(details('Technology Intern', 'Our internship program runs during the summer of 2027.'),
                         ['Summer 2027'])
        self.assertEqual(details("Summer '27 Intern - Cyber Security", ''), ['Summer 2027'])
        self.assertEqual(details('2027 Summer Intern', ''), ['Summer 2027'])

    def test_conflicting_terms_show_nothing(self):
        self.assertEqual(details('Co-op', 'Join us for Summer 2027. Another cohort starts in Fall 2027.'), [])
        self.assertEqual(details('Intern Summer 2027 / Fall 2027', ''), [])

    def test_past_terms_are_ignored(self):
        self.assertEqual(details('Intern', 'Our Summer 2024 interns loved it.'), [])

    def test_length_ranges_and_benefits(self):
        text = """Internship Duration: 10-12 weeks, May-August 2027.
        Parental leave: up to 16 weeks (birthing + bonding) or 8 weeks for the summer program staff."""
        self.assertEqual(details('Intern', text), ['10–12 weeks'])

    def test_conflicting_lengths_show_nothing(self):
        text = 'This team needs a 6-month internship. Able to commit to a full-time, 12-week internship.'
        self.assertEqual(details('Intern', text), [])

    def test_generic_length_ranges_are_ignored(self):
        text = 'Internships typically occur during Fall, Spring and Summer and range in length between 10 - 13 weeks.'
        self.assertEqual(details('Intern', text), [])

    def test_graduation_wording(self):
        self.assertEqual(details('Intern', 'graduating December 2027 or later, with coursework.'),
                         ['Graduating Dec 2027 or later'])
        self.assertEqual(details('Intern', 'Eligible graduation dates: December 2027 or Spring 2028'),
                         ['Graduating Dec 2027 or Spring 2028'])
        self.assertEqual(details('Intern', 'candidates graduating December 2027/Summer 2028 with a focus'),
                         ['Graduating Dec 2027 or Summer 2028'])
        self.assertEqual(details('Intern', 'Open to the Class of 2028.'), ['Class of 2028'])

    def test_partly_readable_graduation_window_shows_nothing(self):
        self.assertEqual(details('Intern', 'Rising senior, graduating December 2027 or May/August 2028.'), [])


if __name__ == '__main__':
    unittest.main()
