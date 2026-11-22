import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  enrollStudent,
  fetchClassRoster,
  listClasses,
  listMembers,
  listOfferings,
  listSessions,
  setElectives,
  transferEnrollment,
  withdrawEnrollment,
} from "@/api/client";

export function EnrollmentPage() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [chosenElectives, setChosenElectives] = useState<string[]>([]);
  const [transferClassId, setTransferClassId] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const sessions = useQuery({ queryKey: ["enrollment", "sessions"], queryFn: listSessions, retry: false });
  const classes = useQuery({
    queryKey: ["enrollment", "classes", sessionId],
    queryFn: () => listClasses(sessionId),
    enabled: Boolean(sessionId),
    retry: false,
  });
  const students = useQuery({
    queryKey: ["enrollment", "students"],
    queryFn: () => listMembers({ roleKind: "student", limit: 100 }),
    retry: false,
  });
  const roster = useQuery({
    queryKey: ["enrollment", "roster", classId],
    queryFn: () => fetchClassRoster(classId, { limit: 100 }),
    enabled: Boolean(classId),
    retry: false,
  });
  const offerings = useQuery({
    queryKey: ["enrollment", "offerings", classId],
    queryFn: () => listOfferings(classId),
    enabled: Boolean(classId),
    retry: false,
  });

  useEffect(() => {
    if (!sessionId && sessions.data?.data.length) setSessionId(sessions.data.data[0]!.id);
  }, [sessionId, sessions.data]);
  useEffect(() => {
    if (!classId && classes.data?.data.length) setClassId(classes.data.data[0]!.id);
  }, [classId, classes.data]);
  useEffect(() => {
    setSelectedEnrollmentId("");
    setChosenElectives([]);
    setTransferClassId("");
  }, [classId]);
  useEffect(() => {
    const row = roster.data?.data.find((item) => item.enrollmentId === selectedEnrollmentId);
    setChosenElectives(
      row?.subjects
        .filter((subject) => !subject.isCompulsory && subject.offeringId)
        .map((subject) => subject.offeringId!) ?? [],
    );
  }, [selectedEnrollmentId, roster.data]);

  const classOptions = classes.data?.data ?? [];
  const rosterRows = roster.data?.data ?? [];
  const electiveOfferings = (offerings.data?.data ?? []).filter((offering) => !offering.isCompulsory);
  const studentName = (id: string) => {
    const member = students.data?.data.find((item) => item.id === id);
    return member ? `${member.firstName} ${member.lastName}` : id;
  };
  const selectedRow = rosterRows.find((row) => row.enrollmentId === selectedEnrollmentId);
  const selectedStudentProfileId = selectedRow?.studentId;
  const targetClasses = classOptions.filter((cls) => cls.id !== classId);

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setBanner(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["enrollment", "roster", classId] });
      await queryClient.invalidateQueries({ queryKey: ["assignments"] });
      setBanner(success);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setPending(false);
    }
  }

  if (sessions.error || classes.error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold">Enrollment</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load enrollment data.</span>
          <button type="button" onClick={() => { sessions.refetch(); classes.refetch(); }} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">Enrollment</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[#71717A]">
        Enrol students into a class, choose electives, transfer or withdraw.
      </p>

      {banner && (
        <div className={`mt-4 rounded-md border px-4 py-3 text-[14px] leading-[18px] ${banner.startsWith("Enrolled") || banner.startsWith("Saved") || banner.startsWith("Transferred") || banner.startsWith("Withdrawn") ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"}`}>
          {banner}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[14px] font-medium">Session</span>
          <select className="mt-1.5 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-[14px]" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.data?.data.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[14px] font-medium">Class</span>
          <select className="mt-1.5 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-[14px]" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classOptions.map((cls) => <option key={cls.id} value={cls.id}>{cls.level.name} {cls.armLabel}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-6 rounded-md border border-[#E4E4E7] bg-white p-4">
        <h2 className="text-[14px] font-semibold">Enrol a student</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select className="h-10 flex-1 rounded-md border border-[#D1D5DB] bg-white px-3 text-[14px]" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select a student</option>
            {students.data?.data.map((student) => <option key={student.id} value={student.id}>{student.firstName} {student.lastName}</option>)}
          </select>
          <button
            type="button"
            disabled={pending || !studentId || !classId}
            onClick={() => run(() => enrollStudent({ studentId, classId }), "Enrolled student.")}
            className="h-10 rounded-md bg-[#2563EB] px-4 text-[14px] font-medium text-white disabled:opacity-60"
          >
            Enrol
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-md border border-[#E4E4E7] bg-white">
        <div className="border-b border-[#E4E4E7] bg-[#FAFAFA] px-4 py-3 text-[12px] font-medium text-[#71717A]">
          Enrolled students ({rosterRows.length})
        </div>
        {roster.isLoading ? (
          <p className="px-4 py-6 text-[14px] text-[#71717A]">Loading roster...</p>
        ) : rosterRows.length === 0 ? (
          <p className="px-4 py-6 text-[14px] text-[#71717A]">No students enrolled in this class.</p>
        ) : (
          <div className="divide-y divide-[#E4E4E7]">
            {rosterRows.map((row) => (
              <button
                type="button"
                key={row.enrollmentId}
                onClick={() => setSelectedEnrollmentId(row.enrollmentId === selectedEnrollmentId ? "" : row.enrollmentId)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#FAFAFA] ${row.enrollmentId === selectedEnrollmentId ? "bg-[#EFF6FF]" : ""}`}
              >
                <span>
                  <span className="block text-[14px] font-medium">{row.firstName} {row.lastName}</span>
                  <span className="mt-0.5 block text-[12px] text-[#71717A]">{row.admissionNumber} · {row.subjects.length} subjects</span>
                </span>
                <span className="text-[12px] text-[#71717A]">{row.complete ? "Complete" : "Incomplete"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRow && (
        <div className="mt-6 rounded-md border border-[#E4E4E7] bg-white p-4">
          <h2 className="text-[14px] font-semibold">{selectedRow.firstName} {selectedRow.lastName}</h2>
          <p className="mt-1 text-[12px] text-[#71717A]">Choose elective offerings for this enrollment.</p>

          {electiveOfferings.length === 0 ? (
            <p className="mt-3 text-[14px] text-[#71717A]">This class has no elective offerings.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {electiveOfferings.map((offering) => (
                <label key={offering.id} className="flex items-center gap-2 rounded border border-[#E4E4E7] px-3 py-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={chosenElectives.includes(offering.id)}
                    onChange={(e) => setChosenElectives((current) => e.target.checked ? [...current, offering.id] : current.filter((id) => id !== offering.id))}
                  />
                  {offering.subject.code} · {offering.subject.name}
                </label>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={pending || electiveOfferings.length === 0} onClick={() => run(() => setElectives(selectedRow.enrollmentId, chosenElectives), "Saved electives.")} className="h-9 rounded-md bg-[#2563EB] px-4 text-[14px] font-medium text-white disabled:opacity-60">Save electives</button>
            <select className="h-9 rounded-md border border-[#D1D5DB] bg-white px-3 text-[14px]" value={transferClassId} onChange={(e) => setTransferClassId(e.target.value)}>
              <option value="">Transfer to...</option>
              {targetClasses.map((cls) => <option key={cls.id} value={cls.id}>{cls.level.name} {cls.armLabel}</option>)}
            </select>
            <button type="button" disabled={pending || !transferClassId} onClick={() => run(() => transferEnrollment(selectedRow.enrollmentId, transferClassId), "Transferred student.")} className="h-9 rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium disabled:opacity-60">Transfer</button>
            <button type="button" disabled={pending} onClick={() => { if (window.confirm("Withdraw this student from the class?")) void run(() => withdrawEnrollment(selectedRow.enrollmentId), "Withdrawn student."); }} className="h-9 rounded-md border border-[#FECACA] bg-white px-4 text-[14px] font-medium text-[#B91C1C] disabled:opacity-60">Withdraw</button>
          </div>
        </div>
      )}
    </div>
  );
}
