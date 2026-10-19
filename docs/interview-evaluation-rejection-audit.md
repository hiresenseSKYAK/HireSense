# Evaluation rejection tree before the reliability pass

`InterviewEngine.feedback` can return `source=fallback` through these paths:

| Stage | Current rejection | Classification |
| --- | --- | --- |
| Provider setup | No configured provider or initialization failure | Essential |
| Responses API | Authentication, network, rate-limit, timeout, incomplete response, refusal, or empty structured output | Essential; transport retry is separately bounded |
| Parsing | Invalid JSON, non-object, malformed required `Evaluation` fields, or output beyond the storage budget | Essential for required fields; optional-field schema defects are repairable |
| Score check | Duplicate/missing dimension labels | Essential unless a bounded repair can reconstruct the rubric |
| Score check | Dimension sum differs from model total by more than four | Repairable when four valid in-range dimensions exist; the server can use their sum |
| Evidence check | Empty evidence or any quote not literally found after punctuation/case/whitespace normalization | Empty/all-ungrounded evidence is essential; an isolated bad quote is optional and should be dropped |
| Follow-up | Invalid length or not answer-grounded | Optional; already dropped without discarding feedback |
| Other coaching text | Invalid stronger framing, verbose optional text, or one bad bullet fails strict schema validation | Optional; should be sanitized or dropped |

The deterministic evaluator remains the last resort. Provider errors and refusals must not trigger a semantic repair call. No raw answer, resume, job description, or model output may appear in operational logs.

# Existing AI and job-discovery map

| Surface | Call/model | Context | Cache/fallback | Visibility |
| --- | --- | --- | --- | --- |
| Interview questions, per-answer evaluation, debrief | `StructuredInterviewProvider` via Responses API; `OPENAI_INTERVIEW_MODEL` → `OPENAI_MODEL` → configured default | Bounded job/resume context; answers and prior turns for evaluation/debrief | No result cache; deterministic fallback | Source-aware coaching UI, but valid evaluation was sometimes lost |
| Resume coach | `CareerAIService` with `OPENAI_LIGHT_MODEL` → `OPENAI_MODEL` → default | Bounded parsed resume, no contact fields | Per-user/context in-process cache; deterministic fallback; 20 calls/hour in-process | Resume coaching panel |
| Job preparation | Same light model | Bounded job description, skills, parsed resume | Same cache and budget; deterministic fallback | Job-detail preparation panel |
| Job list and detail match | No model; deterministic skill overlap | Resume skills and structured job skills | No AI call | Match score, matched/missing skills |

The list endpoint does not yet consume a structured candidate context or prior coaching; `best-match` is skill overlap only. Job records come from bounded LinkedIn/Handshake public discovery plus direct Greenhouse, Lever, and Ashby feeds. Scheduled refresh and link checks are deployment operations, not guaranteed live availability. Source posting dates are displayed only when supplied. Deduplication already uses canonical URL, exact content, and conservative cross-source similarity.
