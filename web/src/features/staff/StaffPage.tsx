import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, listMembers, type Member } from "@/api/client";

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
        <span
          key={role}
          className="rounded border border-[#E4E4E7] bg-[#F4F4F5] px-2 py-0.5 text-[12px] leading-4 text-[#52525B]"
        >
          {role}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Member["status"] }) {
  const tone =
    status === "active"
      ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]"
      : status === "suspended"
        ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"
        : "border-[#E4E4E7] bg-[#F4F4F5] text-[#71717A]";
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-[12px] leading-4 ${tone}`}>
      {status}
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      <div className="hidden divide-y divide-[#E4E4E7] md:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-4 px-4 py-4">
            <div className="h-4 w-32 animate-pulse rounded bg-[#E4E4E7]" />
            <div className="h-4 w-40 animate-pulse rounded bg-[#E4E4E7]" />
            <div className="h-4 w-24 animate-pulse rounded bg-[#E4E4E7]" />
            <div className="h-4 w-16 animate-pulse rounded bg-[#E4E4E7]" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-[#E4E4E7] md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-4">
            <div className="h-4 w-36 animate-pulse rounded bg-[#E4E4E7]" />
            <div className="h-3.5 w-48 animate-pulse rounded bg-[#E4E4E7]" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-[#E4E4E7]" />
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
        <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">Staff</h1>
        <Link
          to="/app/staff/new"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[#2563EB] px-4 text-[14px] leading-[18px] text-white hover:bg-[#1D4ED8]"
        >
          Invite teacher
        </Link>
      </div>

      <div className="mt-6">
        <label htmlFor="staff-search" className="sr-only">
          Search staff
        </label>
        <input
          id="staff-search"
          type="search"
          placeholder="Search by name, email, username or role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-[14px] leading-[18px] outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        />
      </div>

      {isLoading ? (
        <div className="mt-4 overflow-hidden rounded-md border border-[#E4E4E7] bg-white">
          <SkeletonRows />
        </div>
      ) : forbidden ? (
        <div className="mt-6 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] leading-[18px] text-[#B91C1C]">
          You do not have permission to view staff for this school.
        </div>
      ) : error ? (
        <div className="mt-6 flex flex-col gap-3 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] leading-[18px] text-[#B91C1C] sm:flex-row sm:items-center sm:justify-between">
          <span>We could not load the staff list.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="h-9 shrink-0 rounded-lg border border-[#FCA5A5] bg-white px-4 text-[14px] font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-md border border-[#E4E4E7] bg-white px-6 py-10 text-center">
          <p className="text-[14px] leading-[18px] text-[#71717A]">
            {search.trim()
              ? "No staff match your search."
              : "No staff yet. Invite a teacher to get started."}
          </p>
          {!search.trim() && (
            <Link
              to="/app/staff/new"
              className="mt-4 inline-flex h-9 items-center rounded-md bg-[#2563EB] px-4 text-[14px] leading-[18px] text-white hover:bg-[#1D4ED8]"
            >
              Invite teacher
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-md border border-[#E4E4E7] bg-white">
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA]">
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[#71717A]">Name</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[#71717A]">Email or Username</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[#71717A]">Role keys</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-[#71717A]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7]">
              {filtered.map((member) => (
                <tr key={member.id} className="hover:bg-[#FAFAFA]">
                  <td className="px-4 py-3 text-[14px] font-medium leading-[18px] text-[#18181B]">
                    {memberLabel(member)}
                  </td>
                  <td className="px-4 py-3 text-[14px] leading-[18px] text-[#71717A]">
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

          <div className="divide-y divide-[#E4E4E7] md:hidden">
            {filtered.map((member) => (
              <div key={member.id} className="px-4 py-4">
                <p className="text-[14px] font-medium leading-[18px] text-[#18181B]">
                  {memberLabel(member)}
                </p>
                <p className="mt-1 text-[14px] leading-[18px] text-[#71717A]">
                  {displayIdentifier(member)}
                </p>
                <p className="mt-1 text-[12px] leading-4 text-[#71717A]">
                  {member.roles.join(", ") || "—"} · {member.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(hasPrevious || hasNext) && !isLoading && !error && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={!hasPrevious || isFetching}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="h-9 rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium text-[#18181B] hover:bg-[#F4F4F5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!hasNext || isFetching}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="h-9 rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium text-[#18181B] hover:bg-[#F4F4F5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
