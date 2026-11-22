import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/client";

function greeting(firstName?: string) {
  if (!firstName) return "Welcome";
  return `${new Date().getHours() < 12 ? "Good morning" : "Good afternoon"}, ${firstName}`;
}

export function PrincipalHomePage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px] space-y-4">
        <div className="h-9 w-64 animate-pulse rounded bg-[var(--border)]" />
        <div className="h-5 w-80 animate-pulse rounded bg-[var(--border)]" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-14 animate-pulse rounded-md border border-[var(--border)] bg-white" />
          <div className="h-14 animate-pulse rounded-md border border-[var(--border)] bg-white" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold">Welcome</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load your school context.</span>
          <button type="button" onClick={() => refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  const permissions = new Set(data.permissions);
  const actions = [
    { to: "/app/staff", label: "Staff", detail: "Manage teachers and school staff", show: permissions.has("users:read") },
    { to: "/app/classes", label: "Classes", detail: "View and organize school classes", show: permissions.has("academics:read") },
    { to: "/app/calendar", label: "Calendar", detail: "Sessions, terms, and the active term", show: permissions.has("academics:read") },
    { to: "/app/enrollment", label: "Enrollment", detail: "Enrol students and choose electives", show: permissions.has("enrollments:manage") },
    { to: "/app/promotion", label: "Promotion", detail: "Preview and commit next-session moves", show: permissions.has("enrollments:manage") },
    { to: "/app/import", label: "Student Import", detail: "Import students from a CSV", show: permissions.has("users:create") },
    { to: "/app/audit", label: "Audit Log", detail: "Review recent account and system activity", show: permissions.has("audit:read") },
  ].filter((action) => action.show);

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--muted)]">Principal workspace</p>
          <h1 className="mt-1 text-[24px] font-semibold leading-8 text-[var(--text)]">{greeting(data.user.firstName)}</h1>
          <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">{data.school.name} · {data.school.slug}</p>
        </div>
        {permissions.has("users:create") && (
          <Link to="/app/staff/new" className="inline-flex h-9 shrink-0 items-center rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)]">
            Invite staff
          </Link>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[var(--muted)]">Current Session</p>
          <p className="mt-1 text-[16px] font-medium">{data.session?.label ?? "—"}</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[var(--muted)]">Active Term</p>
          <p className="mt-1 text-[16px] font-medium">{data.activeTerm?.name ?? "—"}</p>
        </div>
      </div>

      {(!data.session || !data.activeTerm) && (
        <div className="mt-4 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[14px] leading-[18px] text-[#92400E]">
          School setup is incomplete. Ask the owner to create a session and activate a term.
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold leading-[18px]">School operations</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => (
            <Link key={action.to} to={action.to} className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]">
              <p className="text-[14px] font-semibold leading-[18px] text-[var(--text)]">{action.label}</p>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">{action.detail}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
