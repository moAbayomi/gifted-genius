import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, listStudents, type StudentListRow } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 25;

function fullName(student: StudentListRow) {
  return `${student.firstName} ${student.lastName}`.trim();
}

function className(student: StudentListRow) {
  if (!student.levelName || !student.armLabel) return "Not enrolled";
  return `${student.levelName} ${student.armLabel}`;
}

function login(student: StudentListRow) {
  return student.email ?? student.username ?? "—";
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-border md:hidden">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="space-y-2 px-4 py-4">
          <div className="h-4 w-36 animate-pulse rounded bg-[var(--border)]" />
          <div className="h-3.5 w-48 animate-pulse rounded bg-[var(--border)]" />
          <div className="h-3.5 w-28 animate-pulse rounded bg-[var(--border)]" />
        </div>
      ))}
    </div>
  );
}

export function StudentsPage() {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["students", offset, search],
    queryFn: () =>
      listStudents({
        limit: PAGE_SIZE,
        offset,
        ...(search.trim() ? { q: search.trim() } : {}),
      }),
    retry: false,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate({ to: "/login" });
    }
  }, [error, navigate]);

  const rows = data?.data ?? [];
  const forbidden = error instanceof ApiError && error.status === 403;
  const hasPrevious = offset > 0;
  const hasNext = Boolean(data?.pagination.hasMore);

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 text-foreground">Students</h1>
          <p className="mt-1 text-[14px] leading-[18px] text-muted-foreground">
            Students in the current session. Teachers see the classes they are assigned to.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="student-search" className="sr-only">Search students</label>
        <Input
          id="student-search"
          type="search"
          placeholder="Search by name, admission number, email or username"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
        />
      </div>

      {isLoading ? (
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
          <SkeletonRows />
        </div>
      ) : forbidden ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>You do not have permission to view students for this school.</AlertDescription>
        </Alert>
      ) : error ? (
        <Alert variant="destructive" className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AlertDescription>We could not load the student list.</AlertDescription>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        </Alert>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-md border border-border bg-card px-6 py-10 text-center text-[14px] leading-[18px] text-muted-foreground">
          {search.trim() ? "No students match your search." : "No students yet. Create a student or import a CSV to get started."}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-border bg-[var(--surface-muted)]">
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-muted-foreground">Admission no.</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-muted-foreground">Class</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-muted-foreground">Login</th>
                <th className="px-4 py-3 text-[12px] font-medium leading-4 text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((student) => (
                <tr key={student.id} className="hover:bg-[var(--surface-muted)]">
                  <td className="px-4 py-3 text-[14px] font-medium leading-[18px] text-foreground">{fullName(student)}</td>
                  <td className="px-4 py-3 text-[14px] leading-[18px] text-muted-foreground">{student.admissionNumber}</td>
                  <td className="px-4 py-3 text-[14px] leading-[18px] text-muted-foreground">{className(student)}</td>
                  <td className="px-4 py-3 text-[14px] leading-[18px] text-muted-foreground">{login(student)}</td>
                  <td className="px-4 py-3"><Badge variant={student.membershipStatus === "active" ? "success" : "outline"}>{student.membershipStatus}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="divide-y divide-border md:hidden">
            {rows.map((student) => (
              <div key={student.id} className="px-4 py-4">
                <p className="text-[14px] font-medium leading-[18px] text-foreground">{fullName(student)}</p>
                <p className="mt-1 text-[14px] leading-[18px] text-muted-foreground">{student.admissionNumber} · {className(student)}</p>
                <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{login(student)} · {student.membershipStatus}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(hasPrevious || hasNext) && !isLoading && !error && (
        <div className="mt-4 flex items-center justify-between">
          <Button type="button" variant="outline" disabled={!hasPrevious || isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
          <Button type="button" variant="outline" disabled={!hasNext || isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
        </div>
      )}
    </div>
  );
}
