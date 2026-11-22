import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, listMembers, type Member } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 25;

function displayIdentifier(member: Member) {
  return member.email ?? member.username ?? "—";
}

function memberLabel(member: Member) {
  return `${member.firstName} ${member.lastName}`.trim();
}

function RoleKeys({ roles }: { roles: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <Badge key={role} variant="secondary">
          {role}
        </Badge>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Member["status"] }) {
  const variant =
    status === "active" ? "success" : status === "suspended" ? "destructive" : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function SkeletonRows() {
  return (
    <>
      <div className="hidden divide-y divide-[var(--border)] md:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-4 px-4 py-4">
            <div className="h-4 w-32 animate-pulse rounded bg-[var(--border)]" />
            <div className="h-4 w-40 animate-pulse rounded bg-[var(--border)]" />
            <div className="h-4 w-24 animate-pulse rounded bg-[var(--border)]" />
            <div className="h-4 w-16 animate-pulse rounded bg-[var(--border)]" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-[var(--border)] md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-4">
            <div className="h-4 w-36 animate-pulse rounded bg-[var(--border)]" />
            <div className="h-3.5 w-48 animate-pulse rounded bg-[var(--border)]" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-[var(--border)]" />
          </div>
        ))}
      </div>
    </>
  );
}

export function StaffPage() {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["members", offset],
    queryFn: () =>
      listMembers({ limit: PAGE_SIZE, offset, roleKind: "staff" }),
    retry: false,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate({ to: "/login" });
    }
  }, [error, navigate]);

  const filtered = useMemo(() => {
    const members = data?.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return members;
    return members.filter((member) => {
      const haystack = [
        member.firstName,
        member.lastName,
        memberLabel(member),
        member.email ?? "",
        member.username ?? "",
        ...member.roles,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [data, search]);

  const forbidden = error instanceof ApiError && error.status === 403;
  const hasPrevious = offset > 0;
  const hasNext = Boolean(data?.pagination.hasMore);

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">Staff</h1>
        <Button asChild className="shrink-0">
          <Link to="/app/staff/new">Invite staff</Link>
        </Button>
      </div>

      <div className="mt-6">
        <label htmlFor="staff-search" className="sr-only">
          Search staff
        </label>
        <Input
          id="staff-search"
          type="search"
          placeholder="Search by name, email, username or role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="mt-4 overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <SkeletonRows />
        </div>
      ) : forbidden ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>You do not have permission to view staff for this school.</AlertDescription>
        </Alert>
      ) : error ? (
        <Alert variant="destructive" className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AlertDescription>We could not load the staff list.</AlertDescription>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()} className="shrink-0">
              Retry
            </Button>
          </div>
        </Alert>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-md border border-[var(--border)] bg-white px-6 py-10 text-center">
          <p className="text-[14px] leading-[18px] text-[var(--muted)]">
            {search.trim()
              ? "No staff match your search."
              : "No staff yet. Invite a staff member to get started."}
          </p>
          {!search.trim() && (
            <Button asChild className="mt-4">
              <Link to="/app/staff/new">Invite staff</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)]">
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[var(--muted)]">Name</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[var(--muted)]">Email or Username</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[var(--muted)]">Role keys</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[var(--muted)]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((member) => (
                <tr key={member.id} className="hover:bg-[var(--surface-muted)]">
                  <td className="px-4 py-3 text-[14px] font-medium leading-[18px] text-[var(--text)]">
                    {memberLabel(member)}
                  </td>
                  <td className="px-4 py-3 text-[14px] leading-[18px] text-[var(--muted)]">
                    {displayIdentifier(member)}
                  </td>
                  <td className="px-4 py-3">
                    <RoleKeys roles={member.roles} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={member.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="divide-y divide-[var(--border)] md:hidden">
            {filtered.map((member) => (
              <div key={member.id} className="px-4 py-4">
                <p className="text-[14px] font-medium leading-[18px] text-[var(--text)]">
                  {memberLabel(member)}
                </p>
                <p className="mt-1 text-[14px] leading-[18px] text-[var(--muted)]">
                  {displayIdentifier(member)}
                </p>
                <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
                  {member.roles.join(", ") || "—"} · {member.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(hasPrevious || hasNext) && !isLoading && !error && (
        <div className="mt-4 flex items-center justify-between">
          <Button type="button" variant="outline" disabled={!hasPrevious || isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
          <Button type="button" variant="outline" disabled={!hasNext || isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
