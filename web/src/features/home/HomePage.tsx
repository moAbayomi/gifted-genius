import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchMe } from "@/api/client";
import { TeacherHomePage } from "./TeacherHomePage";
import { StudentHomePage } from "./StudentHomePage";
import { PrincipalHomePage } from "./PrincipalHomePage";

function greeting(firstName?: string) {
  if (!firstName) return "Welcome";
  const hour = new Date().getHours();
  return `${hour < 12 ? "Good morning" : "Good afternoon"}, ${firstName}`;
}

export function HomePage() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate({ to: "/login" });
      return;
    }
    if (data?.mustChangePassword) {
      navigate({ to: "/change-password" });
    }
  }, [data, error, navigate]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <div className="h-10 w-64 animate-pulse rounded bg-[var(--border)]" />
        <div className="mt-3 h-5 w-80 animate-pulse rounded bg-[var(--border)]" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="h-14 animate-pulse rounded-md border border-[var(--border)] bg-white" />
          <div className="h-14 animate-pulse rounded-md border border-[var(--border)] bg-white" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">Welcome</h1>
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] leading-[18px] text-[#B91C1C] sm:flex-row sm:items-center sm:justify-between">
          <span>
            {error instanceof ApiError && error.status === 401
              ? "Your session has expired."
              : "We could not load your school context."}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-9 shrink-0 rounded-lg border border-[#FCA5A5] bg-white px-4 text-[14px] font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (data.roles.includes("principal") && !data.roles.includes("owner")) {
    return <PrincipalHomePage />;
  }

  const isOwnerLike = data.roles.includes("owner");
  if (
    data.roles.includes("student") &&
    !isOwnerLike &&
    !data.roles.includes("teacher")
  ) {
    return <StudentHomePage />;
  }
  if (data.roles.includes("teacher") && !isOwnerLike) {
    return <TeacherHomePage />;
  }

  const permissions = new Set(data.permissions);
  const canInvite = permissions.has("users:create");
  const canStaff = permissions.has("users:read");
  const canClasses = permissions.has("academics:read");
  const canAudit = permissions.has("audit:read");
  const canEnroll = permissions.has("enrollments:manage");
  const setupIncomplete = !data.session || !data.activeTerm;

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">
            {greeting(data.user.firstName)}
          </h1>
          <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
            {data.school.name} · {data.school.slug}
          </p>
        </div>
        {canInvite && (
          <Link
            to="/app/staff/new"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-[14px] leading-[18px] text-white hover:bg-[var(--accent-hover)]"
          >
            Invite staff
          </Link>
        )}
      </div>

      <div className="mt-8">
        {setupIncomplete ? (
          <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-4 text-[14px] leading-[18px] text-[#92400E]">
            <p className="font-medium">School setup is incomplete.</p>
            <p className="mt-1">
              Add an academic session and an active term before inviting staff
              or enrolling students.
            </p>
            <Link
              to="/app/setup"
              className="mt-3 inline-block font-medium underline underline-offset-2"
            >
              Finish school setup
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-h-14 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 py-3">
              <span className="text-[12px] leading-4 text-[var(--muted)]">
                Current Session:
              </span>
              <span className="text-[16px] font-medium leading-6 text-[var(--text)]">
                {data.session?.label}
              </span>
            </div>
            <div className="flex min-h-14 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 py-3">
              <span className="text-[12px] leading-4 text-[var(--muted)]">
                Active Term:
              </span>
              <span className="text-[16px] font-medium leading-6 text-[var(--text)]">
                {data.activeTerm?.name}
              </span>
            </div>
          </div>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold leading-[18px] text-[var(--text)]">
          Quick Actions
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {canStaff && (
            <Link
              to="/app/staff"
              className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]"
            >
              <p className="text-[14px] font-semibold leading-[18px] text-[var(--text)]">Staff</p>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
                Manage teachers and school staff
              </p>
            </Link>
          )}
          {canClasses && (
            <Link
              to="/app/classes"
              className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]"
            >
              <p className="text-[14px] font-semibold leading-[18px] text-[var(--text)]">Classes</p>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
                View and organize school classes
              </p>
            </Link>
          )}
          {canEnroll && (
            <Link
              to="/app/enrollment"
              className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]"
            >
              <p className="text-[14px] font-semibold leading-[18px] text-[var(--text)]">Enrollment</p>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
                Enrol students and manage electives
              </p>
            </Link>
          )}
          {canAudit && (
            <Link
              to="/app/audit"
              className="rounded-md border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--border-strong)]"
            >
              <p className="text-[14px] font-semibold leading-[18px] text-[var(--text)]">Audit Log</p>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
                Review recent account and system activity
              </p>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
