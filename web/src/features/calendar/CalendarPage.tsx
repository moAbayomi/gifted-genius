import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listSessions, listTerms } from "@/api/client";

export function CalendarPage() {
  const [sessionId, setSessionId] = useState("");
  const sessions = useQuery({ queryKey: ["calendar", "sessions"], queryFn: listSessions, retry: false });
  const terms = useQuery({
    queryKey: ["calendar", "terms", sessionId],
    queryFn: () => listTerms(sessionId),
    enabled: Boolean(sessionId),
    retry: false,
  });

  useEffect(() => {
    if (!sessionId && sessions.data?.data.length) {
      setSessionId(sessions.data.data[0]!.id);
    }
  }, [sessionId, sessions.data]);

  if (sessions.isLoading) {
    return (
      <div className="mx-auto max-w-[1040px] space-y-3">
        <div className="h-8 w-40 animate-pulse rounded bg-[var(--border)]" />
        <div className="h-28 animate-pulse rounded-md border border-[var(--border)] bg-white" />
      </div>
    );
  }

  if (sessions.error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold">Calendar</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load the academic calendar.</span>
          <button type="button" onClick={() => sessions.refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  const sessionList = sessions.data?.data ?? [];
  const termList = terms.data?.data ?? [];
  const activeTerm = termList.find((term) => term.status === "active");
  const selected = sessionList.find((session) => session.id === sessionId);

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">Calendar</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        Academic sessions and their terms. This screen is read-only; use Setup to change the calendar.
      </p>

      {sessionList.length === 0 ? (
        <div className="mt-6 rounded-md border border-[var(--border)] bg-white px-6 py-10 text-center text-[14px] text-[var(--muted)]">
          No academic sessions yet. Set up a session in the school setup wizard.
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {sessionList.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSessionId(session.id)}
                className={`rounded-md border px-3 py-2 text-[14px] ${
                  session.id === sessionId
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-hover)]"
                    : "border-[var(--border-strong)] bg-white text-[var(--muted-strong)]"
                }`}
              >
                {session.label}
                {session.closedAt ? " · locked" : ""}
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
              <p className="text-[12px] leading-4 text-[var(--muted)]">Current Session</p>
              <p className="mt-1 text-[16px] font-medium">{selected?.label ?? "—"}</p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
              <p className="text-[12px] leading-4 text-[var(--muted)]">Active Term</p>
              <p className="mt-1 text-[16px] font-medium">{activeTerm?.name ?? "None"}</p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-md border border-[var(--border)] bg-white">
            <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-[12px] font-medium text-[var(--muted)]">Terms</div>
            {terms.isLoading ? (
              <div className="px-4 py-4 text-[14px] text-[var(--muted)]">Loading terms...</div>
            ) : termList.length === 0 ? (
              <div className="px-4 py-6 text-[14px] text-[var(--muted)]">No terms in this session yet.</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {termList.map((term) => (
                  <div key={term.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[14px] font-medium text-[var(--text)]">{term.name} <span className="font-normal text-[var(--muted)]">(Term {term.number})</span></p>
                      <p className="mt-1 text-[12px] text-[var(--muted)]">{term.startDate} → {term.endDate}</p>
                    </div>
                    <span className="text-[12px] font-medium uppercase text-[var(--muted)]">{term.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
