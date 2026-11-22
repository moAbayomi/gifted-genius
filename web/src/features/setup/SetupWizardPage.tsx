import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateTerm,
  addOfferings,
  createClass,
  createSession,
  createSubject,
  createTerm,
  listClasses,
  listLevels,
  listOfferings,
  listSessions,
  listSubjects,
  listTerms,
  type ClassRecord,
} from "@/api/client";

const STEPS = [
  { id: "session", label: "Session" },
  { id: "terms", label: "Terms" },
  { id: "classes", label: "Classes" },
  { id: "subjects", label: "Subjects" },
  { id: "offerings", label: "Offerings" },
  { id: "review", label: "Review" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] leading-[18px] text-[#B91C1C] sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="h-8 shrink-0 rounded-md border border-[#FCA5A5] bg-white px-3 text-[12px] font-medium">
          Retry
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[14px] font-medium leading-[18px] text-[var(--text)]">{label}</span>
      <div className="mt-1.5">{children}</div>
      {help && <span className="mt-1 block text-[12px] leading-4 text-[var(--muted)]">{help}</span>}
    </label>
  );
}

const inputClass = "h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3 text-[14px] leading-[18px] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

export function SetupWizardPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<StepId>("session");
  const [sessionId, setSessionId] = useState("");
  const [sessionLabel, setSessionLabel] = useState("2026/2027");
  const [termNumber, setTermNumber] = useState(1);
  const [termName, setTermName] = useState("First Term");
  const [termStart, setTermStart] = useState("2026-09-15");
  const [termEnd, setTermEnd] = useState("2026-12-19");
  const [levelId, setLevelId] = useState("");
  const [armLabel, setArmLabel] = useState("A");
  const [track, setTrack] = useState<ClassRecord["track"]>("general");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [offeringClassId, setOfferingClassId] = useState("");
  const [chosenSubjects, setChosenSubjects] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  const sessions = useQuery({ queryKey: ["setup", "sessions"], queryFn: listSessions, retry: false });
  const levels = useQuery({ queryKey: ["setup", "levels"], queryFn: listLevels, retry: false });
  const terms = useQuery({
    queryKey: ["setup", "terms", sessionId],
    queryFn: () => listTerms(sessionId),
    enabled: Boolean(sessionId),
    retry: false,
  });
  const classes = useQuery({
    queryKey: ["setup", "classes", sessionId],
    queryFn: () => listClasses(sessionId),
    enabled: Boolean(sessionId),
    retry: false,
  });
  const subjects = useQuery({ queryKey: ["setup", "subjects"], queryFn: listSubjects, retry: false });
  const offerings = useQuery({
    queryKey: ["setup", "offerings", offeringClassId],
    queryFn: () => listOfferings(offeringClassId),
    enabled: Boolean(offeringClassId),
    retry: false,
  });

  useEffect(() => {
    if (!sessionId && sessions.data?.data.length) {
      setSessionId(sessions.data.data[0]!.id);
    }
  }, [sessionId, sessions.data]);

  useEffect(() => {
    if (!levelId && levels.data?.levels.length) {
      setLevelId(levels.data.levels[0]!.id);
    }
  }, [levelId, levels.data]);

  useEffect(() => {
    if (!offeringClassId && classes.data?.data.length) {
      setOfferingClassId(classes.data.data[0]!.id);
    }
  }, [offeringClassId, classes.data]);

  const activeTerm = terms.data?.data.find((term) => term.status === "active");

  function refresh() {
    setBanner(null);
    void queryClient.invalidateQueries({ queryKey: ["setup"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  const createSessionMutation = useMutation({
    mutationFn: () => createSession(sessionLabel.trim()),
    onSuccess: (result) => {
      setSessionId(result.session.id);
      setBanner(null);
      setStep("terms");
      void sessions.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not create session."),
  });

  const createTermMutation = useMutation({
    mutationFn: () =>
      createTerm({
        sessionId,
        number: termNumber,
        name: termName.trim(),
        startDate: termStart,
        endDate: termEnd,
      }),
    onSuccess: () => {
      setBanner(null);
      setTermNumber((n) => n + 1);
      setTermName(termNumber === 1 ? "Second Term" : termNumber === 2 ? "Third Term" : "Next Term");
      void terms.refetch();
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not create term."),
  });

  const activateTermMutation = useMutation({
    mutationFn: (termId: string) => activateTerm(termId),
    onSuccess: () => {
      setBanner(null);
      void terms.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not activate term."),
  });

  const createClassMutation = useMutation({
    mutationFn: () =>
      createClass({ sessionId, levelId, armLabel: armLabel.trim(), track }),
    onSuccess: () => {
      setBanner(null);
      void classes.refetch();
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not create class."),
  });

  const createSubjectMutation = useMutation({
    mutationFn: () => createSubject({ code: subjectCode.trim(), name: subjectName.trim() }),
    onSuccess: () => {
      setBanner(null);
      setSubjectCode("");
      setSubjectName("");
      void subjects.refetch();
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not create subject."),
  });

  const addOfferingsMutation = useMutation({
    mutationFn: () =>
      addOfferings(
        offeringClassId,
        chosenSubjects.map((subjectId) => ({ subjectId, isCompulsory: true })),
      ),
    onSuccess: () => {
      setBanner(null);
      setChosenSubjects([]);
      void offerings.refetch();
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not add offerings."),
  });

  const counts = useMemo(
    () => ({
      sessions: sessions.data?.data.length ?? 0,
      terms: terms.data?.data.length ?? 0,
      classes: classes.data?.data.length ?? 0,
      subjects: subjects.data?.data.length ?? 0,
      offerings: offerings.data?.data.length ?? 0,
    }),
    [sessions.data, terms.data, classes.data, subjects.data, offerings.data],
  );

  const currentIndex = STEPS.findIndex((item) => item.id === step);
  const selectedClass = classes.data?.data.find((cls) => cls.id === offeringClassId);

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">School Setup</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        Set up the minimum structure needed before inviting staff or enrolling students.
      </p>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className={`shrink-0 rounded-md border px-3 py-2 text-[12px] font-medium ${
              item.id === step
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : index < currentIndex
                  ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]"
                  : "border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
          >
            {index + 1}. {item.label}
          </button>
        ))}
      </div>

      {banner && <ErrorBanner message={banner} onRetry={refresh} />}

      <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-6">
        {step === "session" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold">Academic session</h2>
              <p className="mt-1 text-[14px] text-[var(--muted)]">A session contains the three terms and all classes for the year.</p>
            </div>
            {sessions.data?.data.length ? (
              <div>
                <p className="text-[14px] font-medium">Use an existing session</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sessions.data.data.map((session) => (
                    <button key={session.id} type="button" onClick={() => setSessionId(session.id)} className={`rounded-md border px-3 py-2 text-[14px] ${session.id === sessionId ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-hover)]" : "border-[var(--border-strong)] bg-white"}`}>
                      {session.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="New session label" help="Format: YYYY/YYYY, for example 2026/2027.">
                <input className={inputClass} value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} placeholder="2026/2027" />
              </Field>
              <button type="button" disabled={createSessionMutation.isPending || !sessionLabel.trim()} onClick={() => createSessionMutation.mutate()} className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60">
                {createSessionMutation.isPending ? "Creating..." : "Create session"}
              </button>
            </div>
          </div>
        )}

        {step === "terms" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold">Terms</h2>
              <p className="mt-1 text-[14px] text-[var(--muted)]">Create the three terms, then activate the current one.</p>
            </div>
            {!sessionId ? (
              <p className="text-[14px] text-[#B45309]">Create or select a session first.</p>
            ) : (
              <>
                <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                  {terms.data?.data.length ? terms.data.data.map((term) => (
                    <div key={term.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[14px] font-medium">{term.name} <span className="text-[var(--muted)]">(Term {term.number})</span></p>
                        <p className="mt-1 text-[12px] text-[var(--muted)]">{term.startDate} → {term.endDate}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium uppercase text-[var(--muted)]">{term.status}</span>
                        {term.status === "planned" && (
                          <button type="button" disabled={activateTermMutation.isPending} onClick={() => activateTermMutation.mutate(term.id)} className="rounded-md border border-[var(--border-strong)] bg-white px-3 py-1.5 text-[12px] font-medium">
                            Activate
                          </button>
                        )}
                      </div>
                    </div>
                  )) : <p className="px-4 py-3 text-[14px] text-[var(--muted)]">No terms yet.</p>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Term number"><input className={inputClass} type="number" min={1} value={termNumber} onChange={(e) => setTermNumber(Number(e.target.value))} /></Field>
                  <Field label="Term name"><input className={inputClass} value={termName} onChange={(e) => setTermName(e.target.value)} /></Field>
                  <Field label="Start date"><input className={inputClass} type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} /></Field>
                  <Field label="End date"><input className={inputClass} type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} /></Field>
                </div>
                <button type="button" disabled={createTermMutation.isPending} onClick={() => createTermMutation.mutate()} className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
                  {createTermMutation.isPending ? "Creating..." : "Add term"}
                </button>
              </>
            )}
          </div>
        )}

        {step === "classes" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold">Classes</h2>
              <p className="mt-1 text-[14px] text-[var(--muted)]">Create at least one class for this session.</p>
            </div>
            {!sessionId ? <p className="text-[14px] text-[#B45309]">Select a session first.</p> : (
              <>
                <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                  {classes.data?.data.length ? classes.data.data.map((cls) => (
                    <div key={cls.id} className="flex items-center justify-between px-4 py-3 text-[14px]">
                      <span className="font-medium">{cls.level.name} {cls.armLabel}</span>
                      <span className="text-[12px] text-[var(--muted)]">{cls.track}</span>
                    </div>
                  )) : <p className="px-4 py-3 text-[14px] text-[var(--muted)]">No classes yet.</p>}
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Level">
                    <select className={inputClass} value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                      {levels.data?.levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Arm"><input className={inputClass} value={armLabel} onChange={(e) => setArmLabel(e.target.value)} placeholder="A" /></Field>
                  <Field label="Track">
                    <select className={inputClass} value={track} onChange={(e) => setTrack(e.target.value as ClassRecord["track"])}>
                      <option value="general">General</option>
                      <option value="science">Science</option>
                      <option value="arts">Arts</option>
                      <option value="commercial">Commercial</option>
                    </select>
                  </Field>
                </div>
                <button type="button" disabled={createClassMutation.isPending || !levelId} onClick={() => createClassMutation.mutate()} className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
                  {createClassMutation.isPending ? "Creating..." : "Add class"}
                </button>
              </>
            )}
          </div>
        )}

        {step === "subjects" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold">Subjects</h2>
              <p className="mt-1 text-[14px] text-[var(--muted)]">Create the subjects this school teaches.</p>
            </div>
            <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
              {subjects.data?.data.length ? subjects.data.data.map((subject) => (
                <div key={subject.id} className="flex items-center justify-between px-4 py-3 text-[14px]">
                  <span className="font-medium">{subject.code}</span>
                  <span className="text-[var(--muted)]">{subject.name}</span>
                </div>
              )) : <p className="px-4 py-3 text-[14px] text-[var(--muted)]">No subjects yet.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code"><input className={inputClass} value={subjectCode} onChange={(e) => setSubjectCode(e.target.value.toUpperCase())} placeholder="ENG" /></Field>
              <Field label="Name"><input className={inputClass} value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="English" /></Field>
            </div>
            <button type="button" disabled={createSubjectMutation.isPending || !subjectCode.trim() || !subjectName.trim()} onClick={() => createSubjectMutation.mutate()} className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
              {createSubjectMutation.isPending ? "Creating..." : "Add subject"}
            </button>
          </div>
        )}

        {step === "offerings" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold">Offerings</h2>
              <p className="mt-1 text-[14px] text-[var(--muted)]">Choose which subjects each class offers. They are created as compulsory for now.</p>
            </div>
            <Field label="Class">
              <select className={inputClass} value={offeringClassId} onChange={(e) => { setOfferingClassId(e.target.value); setChosenSubjects([]); }}>
                {classes.data?.data.map((cls) => <option key={cls.id} value={cls.id}>{cls.level.name} {cls.armLabel}</option>)}
              </select>
            </Field>
            {selectedClass && (
              <>
                <div className="rounded-md border border-[var(--border)]">
                  {offerings.data?.data.length ? offerings.data.data.map((offering) => (
                    <div key={offering.id} className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5 text-[14px] last:border-0">
                      <span>{offering.subject.code} · {offering.subject.name}</span>
                      <span className="text-[12px] text-[var(--muted)]">{offering.isCompulsory ? "Compulsory" : "Elective"}</span>
                    </div>
                  )) : <p className="px-4 py-3 text-[14px] text-[var(--muted)]">No offerings yet.</p>}
                </div>
                <div>
                  <p className="text-[14px] font-medium">Add subjects</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {subjects.data?.data.filter((subject) => !offerings.data?.data.some((offering) => offering.subjectId === subject.id)).map((subject) => (
                      <label key={subject.id} className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-[14px]">
                        <input type="checkbox" checked={chosenSubjects.includes(subject.id)} onChange={(e) => setChosenSubjects((current) => e.target.checked ? [...current, subject.id] : current.filter((id) => id !== subject.id))} />
                        {subject.code} · {subject.name}
                      </label>
                    ))}
                  </div>
                </div>
                <button type="button" disabled={addOfferingsMutation.isPending || chosenSubjects.length === 0} onClick={() => addOfferingsMutation.mutate()} className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
                  {addOfferingsMutation.isPending ? "Adding..." : "Add selected offerings"}
                </button>
              </>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[18px] font-semibold">Setup summary</h2>
              <p className="mt-1 text-[14px] text-[var(--muted)]">You can return here later to finish any missing step.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Sessions", counts.sessions],
                ["Terms", counts.terms],
                ["Active term", activeTerm ? 1 : 0],
                ["Classes", counts.classes],
                ["Subjects", counts.subjects],
                ["Offerings", counts.offerings],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border border-[var(--border)] px-4 py-3">
                  <p className="text-[12px] text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-[18px] font-medium">{value}</p>
                </div>
              ))}
            </div>
            {(!activeTerm || counts.classes === 0 || counts.subjects === 0 || counts.offerings === 0) && (
              <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[14px] leading-[18px] text-[#92400E]">
                Setup is not complete. Finish the missing steps before inviting staff or enrolling students.
              </div>
            )}
            <Link to="/app" className="inline-flex h-10 items-center rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)]">
              Go to Home
            </Link>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-[var(--border)] pt-4">
          <button type="button" disabled={currentIndex === 0} onClick={() => setStep(STEPS[currentIndex - 1]!.id)} className="h-9 rounded-md border border-[var(--border-strong)] bg-white px-4 text-[14px] font-medium disabled:opacity-50">
            Back
          </button>
          <button type="button" disabled={currentIndex === STEPS.length - 1} onClick={() => setStep(STEPS[currentIndex + 1]!.id)} className="h-9 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-50">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
