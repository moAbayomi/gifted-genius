import { useEffect } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchClassRoster, fetchMe } from "@/api/client";
import { Button } from "@/components/ui/button";

export function RosterPage() {
  const navigate = useNavigate();
  const { classId } = useParams({ strict: false }) as { classId: string };
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const canImport = me.data?.permissions.includes("students:import") ?? false;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["roster", classId],
    queryFn: () => fetchClassRoster(classId, { limit: 100 }),
    retry: false,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) navigate({ to: "/login" });
  }, [error, navigate]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--border)]" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md border border-[var(--border)] bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-[1040px]">
        <Link to="/app/classes" className="text-[14px] text-[var(--muted)] hover:text-[var(--text)]">← My Classes</Link>
        <div className="mt-6 flex flex-col gap-3 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C] sm:flex-row sm:items-center sm:justify-between">
          <span>
            {notFound
              ? "This class was not found or is outside your assignments."
              : "We could not load this class roster."}
          </span>
          {!notFound && (
            <button type="button" onClick={() => refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
          )}
        </div>
      </div>
    );
  }

  const rows = data!.data;
  return (
    <div className="mx-auto max-w-[1040px]">
      <Link to="/app/classes" className="text-[14px] text-[var(--muted)] hover:text-[var(--text)]">← My Classes</Link>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">Class Roster</h1>
          <p className="mt-1 text-[14px] leading-[18px] text-[var(--muted)]">
            {rows.length} {rows.length === 1 ? "student" : "students"}
          </p>
        </div>
        {canImport && (
          <Button asChild>
            <Link to="/app/import" search={{ classId }}>Import students</Link>
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-md border border-[var(--border)] bg-white px-6 py-10 text-center text-[14px] text-[var(--muted)]">
          No students are enrolled in this class yet.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
                <th className="px-4 py-3 text-[12px] font-medium text-[var(--muted)]">Name</th>
                <th className="px-4 py-3 text-[12px] font-medium text-[var(--muted)]">Admission No.</th>
                <th className="px-4 py-3 text-[12px] font-medium text-[var(--muted)]">Subjects</th>
                <th className="px-4 py-3 text-[12px] font-medium text-[var(--muted)]">Selection</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((student) => (
                <tr key={student.enrollmentId} className="hover:bg-[var(--surface-muted)]">
                  <td className="px-4 py-3 text-[14px] font-medium text-[var(--text)]">
                    <Link to="/app/classes/$classId/students/$studentId" params={{ classId, studentId: student.studentId }} className="hover:underline">
                      {student.firstName} {student.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[14px] text-[var(--muted)]">{student.admissionNumber}</td>
                  <td className="px-4 py-3 text-[14px] text-[var(--muted)]">
                    {student.subjects.map((s) => s.name).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-[12px] ${student.complete ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"}`}>
                      {student.complete ? "Complete" : "Incomplete"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="divide-y divide-[var(--border)] md:hidden">
            {rows.map((student) => (
              <Link key={student.enrollmentId} to="/app/classes/$classId/students/$studentId" params={{ classId, studentId: student.studentId }} className="block px-4 py-4">
                <p className="text-[14px] font-medium text-[var(--text)]">{student.firstName} {student.lastName}</p>
                <p className="mt-1 text-[14px] text-[var(--muted)]">{student.admissionNumber}</p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  {student.subjects.map((s) => s.code).join(", ") || "No subjects"} · {student.complete ? "Complete" : "Incomplete"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
