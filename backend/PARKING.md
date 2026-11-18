# Parking lot

## Extra subjects (student-specific offering)

**Status: removed before 2c.**

`student_subjects` previously allowed a nullable `class_subject_id` plus a
`subject_id`/`is_extra` path for a principal-approved subject not offered to the
whole class. It was not part of the confirmed school workflow and broke the
scope chain: teachers are assigned to offerings, so an extra row had no offering
and no teacher who could score it.

Revisit only if a school confirms the workflow and the scoring path is designed.
