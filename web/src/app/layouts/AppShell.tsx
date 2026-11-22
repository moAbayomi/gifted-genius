import { useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMe, logoutRequest } from "@/api/client";

export function AppLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname === "/login" || pathname === "/change-password") {
    return <Outlet />;
  }

  return <AppShell />;
}

function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSuccess: () => {
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  const permissions = new Set(data?.permissions ?? []);
  const roles = data?.roles ?? [];
  const primaryRole = roles.includes("owner")
    ? "owner"
    : roles.includes("principal")
      ? "principal"
      : roles.includes("teacher")
        ? "teacher"
        : roles.includes("student")
          ? "student"
          : roles.includes("guardian")
            ? "guardian"
            : "default";
  const nav = [
    { to: "/app", label: "Home", show: true },
    { to: "/app/staff", label: "Staff", show: permissions.has("users:read") },
    { to: "/app/classes", label: "Classes", show: permissions.has("academics:read") },
    { to: "/app/students", label: "Students", show: permissions.has("enrollments:read") },
    { to: "/app/calendar", label: "Calendar", show: permissions.has("academics:read") },
    { to: "/app/enrollment", label: "Enrollment", show: permissions.has("enrollments:manage") },
    { to: "/app/promotion", label: "Promotion", show: permissions.has("enrollments:manage") },
    { to: "/app/import", label: "Student Import", show: permissions.has("students:import") },
    { to: "/app/audit", label: "Audit Log", show: permissions.has("audit:read") },
  ].filter((item) => item.show);

  const roleLabel = data?.roles.length
    ? data.roles.map((role) => role.charAt(0).toUpperCase() + role.slice(1)).join(", ")
    : "—";

  return (
    <div data-role={primaryRole} className="min-h-screen bg-[var(--bg)] md:flex">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[319px] flex-col border-r border-[var(--border)] bg-white transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pb-4 pt-4">
          <div className="truncate text-[18px] font-medium leading-6 text-[var(--text)]">
            {data?.school.name ?? "GiftedMind"}
          </div>
          <div className="mt-1 truncate text-[14px] leading-[18px] text-[var(--muted)]">
            {data?.school.slug ?? ""}
          </div>
        </div>

        <div className="mx-4 border-t border-[var(--border)]" />

        <nav className="flex flex-col gap-1 px-4 pt-4">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`flex h-10 items-center rounded-md px-3 text-[16px] leading-6 transition-colors ${
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-[var(--border)] px-4 py-4">
          <p className="text-[12px] font-medium leading-4 text-[var(--text)]">
            Role: {roleLabel}
          </p>
          <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
            Password: {data?.mustChangePassword ? "Temporary" : "Active"}
          </p>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="mt-3 text-[12px] leading-4 text-[var(--muted)] underline-offset-2 hover:text-[var(--text)] hover:underline disabled:opacity-60"
          >
            {logoutMutation.isPending ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-white px-4 md:hidden">
          <span className="truncate text-[16px] font-medium">
            {data?.school.name ?? "GiftedMind"}
          </span>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[14px]"
          >
            Menu
          </button>
        </header>

        <main className="px-6 py-8 md:px-12 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

