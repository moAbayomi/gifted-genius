import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMyAssignments, fetchMe } from "@/api/client";
import { OwnerClassesPage } from "./OwnerClassesPage";

export function ClassesRoutePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <div className="h-8 w-40 animate-pulse rounded bg-[var(--border)]" />
        <div className="mt-6 h-24 animate-pulse rounded-md border border-[var(--border)] bg-white" />
      </div>
    );
  }

  const roles = data?.roles ?? [];
  if (roles.includes("owner") || roles.includes("principal")) {
    return <OwnerClassesPage />;
  }

  return <TeacherClassesPage />;
}

export function TeacherClassesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["assignments"],
    queryFn: fetchMyAssignments,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <div className="h-8 w-40 animate-pulse rounded bg-[var(--border)]" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md border border-[var(--border)] bg-white" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold">My Classes</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load your classes.</span>
          <button type="button" onClick={() => refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  const assignments = data!;
  const classes = new Map<string, { id: string; name: string; detail: string }>();
  for (const cls of assignments.formTeacherClasses) {
    classes.set(cls.id, {
      id: cls.id,
      name: cls.displayName,
      detail: "Form teacher",
    });
  }
  for (const offering of assignments.subjectOfferings) {
    const existing = classes.get(offering.classId);
    classes.set(offering.classId, {
      id: offering.classId,
      name: offering.className,
      detail: existing
        ? `${existing.detail} · ${offering.subject.name}`
        : `You teach ${offering.subject.name}`,
    });
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">My Classes</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        {assignments.session?.label ?? "No active session"}
      </p>

      {classes.size === 0 ? (
        <div className="mt-6 rounded-md border border-[var(--border)] bg-white px-6 py-10 text-center text-[14px] leading-[18px] text-[var(--muted)]">
          You have no assignments yet. Ask your principal to assign you a class.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-md border border-[var(--border)] bg-white">
          {[...classes.values()].map((cls) => (
            <Link
              key={cls.id}
              to="/app/classes/$classId"
              params={{ classId: cls.id }}
              className="block border-b border-[var(--border)] px-4 py-4 last:border-b-0 hover:bg-[var(--surface-muted)]"
            >
              <p className="text-[16px] font-medium leading-6 text-[var(--text)]">{cls.name}</p>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">{cls.detail}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
