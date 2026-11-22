import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, fetchMyAssignments } from "@/api/client";

function greeting(firstName?: string) {
  if (!firstName) return "Welcome";
  return `${new Date().getHours() < 12 ? "Good morning" : "Good afternoon"}, ${firstName}`;
}

export function TeacherHomePage() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const assignments = useQuery({
    queryKey: ["assignments"],
    queryFn: fetchMyAssignments,
    retry: false,
  });

  if (me.isLoading || assignments.isLoading) {
    return (
      <div className="mx-auto max-w-[1040px] space-y-4">
        <div className="h-9 w-64 animate-pulse rounded bg-[var(--border)]" />
        <div className="h-5 w-80 animate-pulse rounded bg-[var(--border)]" />
        <div className="h-28 animate-pulse rounded-md border border-[var(--border)] bg-white" />
      </div>
    );
  }

  if (me.error || assignments.error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold leading-8">Welcome</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load your assignments.</span>
          <button
            type="button"
            onClick={() => {
              me.refetch();
              assignments.refetch();
            }}
            className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const data = me.data!;
  const a = assignments.data!;
  const hasAssignments =
    a.formTeacherClasses.length > 0 || a.subjectOfferings.length > 0;

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">
        {greeting(data.user.firstName)}
      </h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        {data.school.name} · {a.session?.label ?? "No active session"}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[var(--muted)]">Current Session</p>
          <p className="mt-1 text-[16px] font-medium">{a.session?.label ?? "—"}</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[var(--muted)]">Active Term</p>
          <p className="mt-1 text-[16px] font-medium">
            {data.activeTerm?.name ?? "—"}
          </p>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold leading-[18px]">My Classes</h2>
          <Link
            to="/app/classes"
            className="text-[14px] leading-[18px] text-[var(--accent)] hover:underline"
          >
            View all
          </Link>
        </div>

        {!hasAssignments ? (
          <div className="mt-4 rounded-md border border-[var(--border)] bg-white px-6 py-8 text-center text-[14px] leading-[18px] text-[var(--muted)]">
            You have no assignments yet. Ask your principal to assign you a
            class.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {a.formTeacherClasses.map((cls) => (
              <Link
                key={cls.id}
                to="/app/classes/$classId"
                params={{ classId: cls.id }}
                className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]"
              >
                <p className="text-[14px] font-semibold">{cls.displayName}</p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">Form teacher</p>
              </Link>
            ))}
            {Array.from(
              new Map(a.subjectOfferings.map((o) => [o.classId, o])).values(),
            ).map((offering) => (
              <Link
                key={offering.classId}
                to="/app/classes/$classId"
                params={{ classId: offering.classId }}
                className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]"
              >
                <p className="text-[14px] font-semibold">{offering.className}</p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  You teach {offering.subject.name}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
