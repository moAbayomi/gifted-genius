# Web Structure and Phase Status

This document answers two questions:

1. Can the frontend be reorganized into feature folders?
2. Where are we against F2, F3, and F4?

---

## 1. Yes, the folder structure is a good direction

The proposed structure is sound, with a few corrections:

- keep the route tree central in `src/app/router.tsx`;
- do not let every feature own its own router;
- use `enrollment`, not `enrolment`, to match the backend module and API;
- add missing feature areas: `setup`, `student`, `home`, and `import`;
- do not put student import under `promotion`; they are different flows.

Recommended target:

```text
web/
  src/
    app/
      router.tsx
      providers.tsx
      layouts/
        AppShell.tsx
        AuthLayout.tsx

    api/
      client.ts
      schema.d.ts          # generated, never hand-edited
      errors.ts
      invite-store.ts

    features/
      auth/
        LoginPage.tsx
        ChangePasswordPage.tsx
        useMe.ts
        guards.ts

      home/
        OwnerHomePage.tsx
        TeacherHomePage.tsx
        StudentHomePage.tsx

      staff/
        StaffPage.tsx
        InviteTeacherPage.tsx
        TeacherCredentialsPage.tsx

      calendar/
        SessionsPage.tsx
        TermsPage.tsx

      classes/
        ClassesPage.tsx
        RosterPage.tsx
        StudentDetailPage.tsx

      enrollment/
        EnrollmentPage.tsx
        ElectivesPage.tsx
        TransferDialog.tsx

      assignments/
        AssignmentsPage.tsx
        TeacherAssignmentDialog.tsx

      setup/
        SetupWizardPage.tsx
        steps/
          SessionStep.tsx
          TermsStep.tsx
          ClassesStep.tsx
          SubjectsStep.tsx
          OfferingsStep.tsx
          ReviewStep.tsx

      promotion/
        PromotionPreviewPage.tsx
        PromotionCommitDialog.tsx

      import/
        StudentImportPage.tsx
        validate-import.ts

      student/
        MeSubjectsPage.tsx
        WardsPage.tsx        # guardian, later

    components/
      Button.tsx
      Input.tsx
      Field.tsx
      Card.tsx
      Alert.tsx
      Dialog.tsx
      Table.tsx
      Skeleton.tsx
      PageHeader.tsx

    lib/
      permissions.ts
      dates.ts
      format.ts

    styles/
      index.css            # Tailwind + design tokens

  tests/
```

---

## 2. Current files → target files

| Current | Target |
|---|---|
| `src/main.tsx` | `src/app/main.tsx` |
| `src/router.tsx` | `src/app/router.tsx` |
| `src/routes/app.tsx` | split into `app/layouts/AppShell.tsx`, `features/home/*` |
| `src/routes/login.tsx` | `features/auth/LoginPage.tsx` |
| `src/routes/change-password.tsx` | `features/auth/ChangePasswordPage.tsx` |
| `src/routes/staff.tsx` | `features/staff/StaffPage.tsx` |
| `src/routes/invite-teacher.tsx` | `features/staff/InviteTeacherPage.tsx` |
| `src/routes/teacher-credentials.tsx` | `features/staff/TeacherCredentialsPage.tsx` |
| `src/routes/teacher-home.tsx` | `features/home/TeacherHomePage.tsx` |
| `src/routes/student-home.tsx` | `features/home/StudentHomePage.tsx` |
| `src/routes/teacher-classes.tsx` | `features/classes/ClassesPage.tsx` |
| `src/routes/roster.tsx` | `features/classes/RosterPage.tsx` |
| `src/routes/student-detail.tsx` | `features/classes/StudentDetailPage.tsx` |
| `src/routes/setup.tsx` | `features/setup/SetupWizardPage.tsx` |
| `src/routes/placeholder.tsx` | delete as screens become real |
| `src/api/client.ts` | keep, optionally split HTTP + query helpers |
| `src/api/schema.d.ts` | keep generated; update `generate:api` output if moved |
| `src/styles.css` | `src/styles/index.css` |

Keep route definitions in `src/app/router.tsx`, importing page components from `features/*`.

---

## 3. Migration rules

1. Add a path alias:
   - `@/*` → `src/*`;
   - update `tsconfig.json` and `vite.config.ts`.
2. Move one area at a time.
3. Run `npm run build` after each move.
4. Do not change behavior and move files in the same commit.
5. Do not move the generated `schema.d.ts` manually; change the generation script.
6. Avoid feature-to-feature imports. Shared things go in `components`, `lib`, or `api`.
7. Extract a component only when it has a second use. Do not pre-build a design system with one consumer.
8. Keep the layout/auth guards centralized in `app/` and `features/auth/`.

The easiest order:

```text
api → styles → components → auth → staff → classes → setup → home → router imports
```

---

## 4. Where are we against F2/F3/F4?

You are not cleanly at one phase. You pulled the setup wizard forward, which is fine.

### F2 — read-only screens

| Screen | Status |
|---|---|
| Calendar/session/term read view | **Missing** |
| Owner class list | Partial; setup wizard lists classes |
| Teacher’s own classes | Done |
| Class roster | Done |
| Roster/student detail | Done |
| Four states | Mostly done for roster/classes |

**F2 is close, but not complete.**

### F3 — writes and forms

| Screen | Status |
|---|---|
| Invite teacher | Done |
| Staff list + credentials | Done |
| Create/edit class | Create exists in setup; no general edit UI |
| Enrol student | Missing |
| Choose electives | Missing |
| Transfer/withdraw | Missing |
| Confirm dialogs | Not built broadly |

**F3 is early/partial.**

### F4 — setup flows

| Screen | Status |
|---|---|
| Session/terms/classes/subjects/offerings wizard | Done |
| Student creation in wizard | Missing |
| Student import routes/UI | Missing |
| Promotion preview/review/commit UI | Missing |

**F4 is partially done.**

### Honest summary

```text
F2: mostly done, missing calendar read screen
F3: early
F4: setup wizard done, promotion/import not
```

---

## 5. Recommended next order

If the goal is a usable school as soon as possible:

1. **F3: enrol students and choose electives**
   - setup creates classes and offerings;
   - without enrolment, rosters and student views stay empty.

2. **F2: calendar read screen**
   - one page showing session, terms, active term;
   - useful for owner/teacher context.

3. **F3: transfer/withdraw**
   - reuses the enrolment path.

4. **F4: promotion preview**
   - now that classes and students exist.

5. **F4: student import**
   - after create/enrol works.

6. **F2/F3: owner class list and edits**.

The formal phase order was F2 → F3 → F4, but your vertical slices have already crossed them. The next practical slice is **enrolment**, because it unlocks every remaining student/teacher screen.
