import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitPromotionPlan,
  listClasses,
  listSessions,
  previewPromotion,
  type PromotionPreview,
} from "@/api/client";

type DecisionMode = "promote" | "choose" | "graduate" | "leave";
type Decision = { mode: DecisionMode; targetClassId: string };

function statusTone(action: PromotionPreview["rows"][number]["action"]) {
  if (action === "promote") return "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]";
  if (action === "graduate") return "border-[#BFDBFE] bg-[var(--accent-soft)] text-[var(--accent-hover)]";
  return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
}

export function PromotionPage() {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof commitPromotionPlan>> | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const sessions = useQuery({ queryKey: ["promotion", "sessions"], queryFn: listSessions, retry: false });
  const targetClasses = useQuery({
    queryKey: ["promotion", "classes", targetId],
    queryFn: () => listClasses(targetId),
    enabled: Boolean(targetId),
    retry: false,
  });
  const preview = useQuery({
    queryKey: ["promotion", "preview", sourceId, targetId],
    queryFn: () => previewPromotion(sourceId, targetId),
    enabled: Boolean(sourceId && targetId && sourceId !== targetId),
    retry: false,
  });

  useEffect(() => {
    const list = sessions.data?.data ?? [];
    if (!sourceId && list.length > 1) setSourceId(list[1]!.id);
    if (!targetId && list.length > 0) setTargetId(list[0]!.id);
  }, [sessions.data, sourceId, targetId]);

  useEffect(() => {
    if (!preview.data) return;
    const next: Record<string, Decision> = {};
    for (const row of preview.data.rows) {
      if (row.action === "graduate") {
        next[row.enrollmentId] = { mode: "graduate", targetClassId: "" };
      } else if (row.action === "promote" && row.targetClassId) {
        next[row.enrollmentId] = { mode: "promote", targetClassId: row.targetClassId };
      } else {
        next[row.enrollmentId] = { mode: "choose", targetClassId: "" };
      }
    }
    setDecisions(next);
    setResult(null);
    setBanner(null);
  }, [preview.data]);

  const classes = targetClasses.data?.data ?? [];
  const classById = useMemo(() => new Map(classes.map((cls) => [cls.id, cls])), [classes]);

  const plan = useMemo<Array<{ enrollmentId: string; targetClassId: string | null }>>(() => {
    const out: Array<{ enrollmentId: string; targetClassId: string | null }> = [];
    for (const row of preview.data?.rows ?? []) {
      const decision = decisions[row.enrollmentId];
      if (!decision || decision.mode === "leave") continue;
      if (decision.mode === "graduate") {
        out.push({ enrollmentId: row.enrollmentId, targetClassId: null });
        continue;
      }
      if (decision.targetClassId) {
        out.push({
          enrollmentId: row.enrollmentId,
          targetClassId: decision.targetClassId,
        });
      }
    }
    return out;
  }, [preview.data, decisions]);

  const unresolved = (preview.data?.rows ?? []).filter((row) => {
    const decision = decisions[row.enrollmentId];
    return decision && decision.mode !== "leave" && decision.mode !== "graduate" && !decision.targetClassId;
  }).length;

  const commit = useMutation({
    mutationFn: () => commitPromotionPlan(sourceId, targetId, plan),
    onSuccess: (data) => {
      setResult(data);
      setBanner(null);
      void queryClient.invalidateQueries({ queryKey: ["promotion"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Promotion failed."),
  });

  if (sessions.isLoading) {
    return <div className="mx-auto max-w-[1040px]"><div className="h-8 w-48 animate-pulse rounded bg-[var(--border)]" /><div className="mt-6 h-40 animate-pulse rounded-md border border-[var(--border)] bg-white" /></div>;
  }

  if (sessions.error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold">Promotion</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load sessions.</span>
          <button type="button" onClick={() => sessions.refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  const sessionList = sessions.data?.data ?? [];

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">Promotion</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        Preview where active students will move next session, choose a target class for track changes, and commit. Nothing is written until you commit.
      </p>

      {banner && <div className="mt-4 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] text-[#B91C1C]">{banner}</div>}
      {result && (
        <div className="mt-4 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-[14px] text-[#15803D]">
          Promoted {result.created}; ended {result.sourceEnded} source enrolments; created {result.subjectsCreated} subject rows; skipped {result.skipped.length}.
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block text-[14px]">
          <span className="font-medium">Source session</span>
          <select className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Select source</option>
            {sessionList.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
        </label>
        <label className="block text-[14px]">
          <span className="font-medium">Target session</span>
          <select className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select target</option>
            {sessionList.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
        </label>
      </div>

      {preview.isLoading && <p className="mt-6 text-[14px] text-[var(--muted)]">Building preview...</p>}
      {preview.error && <div className="mt-6 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] text-[#B91C1C]">Could not build the promotion preview.</div>}
      {preview.data && (
        <>
          <div className="mt-6 flex flex-wrap gap-2 text-[12px] text-[var(--muted)]">
            {Object.entries(preview.data.counts).map(([key, value]) => (
              <span key={key} className="rounded border border-[var(--border)] bg-white px-2 py-1">{key}: {value}</span>
            ))}
          </div>

          {preview.data.rows.length === 0 ? (
            <div className="mt-4 rounded-md border border-[var(--border)] bg-white px-6 py-8 text-center text-[14px] text-[var(--muted)]">No active enrolments in the source session.</div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border border-[var(--border)] bg-white">
              <div className="divide-y divide-[var(--border)]">
                {preview.data.rows.map((row) => {
                  const decision = decisions[row.enrollmentId] ?? { mode: "leave" as const, targetClassId: "" };
                  const suggested = classById.get(row.targetClassId ?? "");
                  return (
                    <div key={row.enrollmentId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium">{row.studentId.slice(0, 8)} · <span className={`rounded border px-1.5 py-0.5 text-[12px] ${statusTone(row.action)}`}>{row.action}</span></p>
                        <p className="mt-1 text-[12px] text-[var(--muted)]">
                          {suggested ? `Suggested: ${suggested.level.name} ${suggested.armLabel}` : row.warnings.join(", ") || "Choose a target class"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={decision.mode}
                          onChange={(e) => {
                            const mode = e.target.value as DecisionMode;
                            setDecisions((current) => ({
                              ...current,
                              [row.enrollmentId]: {
                                mode,
                                targetClassId:
                                  mode === "promote" || mode === "choose"
                                    ? current[row.enrollmentId]?.targetClassId ?? (mode === "promote" ? row.targetClassId ?? "" : "")
                                    : "",
                              },
                            }));
                          }}
                          className="h-9 rounded-md border border-[var(--border-strong)] bg-white px-2 text-[12px]"
                        >
                          <option value="promote">Promote</option>
                          <option value="choose">Choose class</option>
                          <option value="graduate">Graduate</option>
                          <option value="leave">Leave</option>
                        </select>
                        {(decision.mode === "promote" || decision.mode === "choose") && (
                          <select
                            value={decision.targetClassId}
                            onChange={(e) => setDecisions((current) => ({ ...current, [row.enrollmentId]: { ...decision, targetClassId: e.target.value } }))}
                            className="h-9 max-w-[260px] rounded-md border border-[var(--border-strong)] bg-white px-2 text-[12px]"
                          >
                            <option value="">Select target class</option>
                            {classes.map((cls) => <option key={cls.id} value={cls.id}>{cls.level.name} {cls.armLabel}{cls.track !== "general" ? ` · ${cls.track}` : ""}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={commit.isPending || plan.length === 0 || unresolved > 0}
              onClick={() => commit.mutate()}
              className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60"
            >
              {commit.isPending ? "Committing..." : `Commit ${plan.length} decisions`}
            </button>
            {unresolved > 0 && <span className="text-[12px] text-[#B91C1C]">{unresolved} row(s) need a target class.</span>}
            <span className="text-[12px] text-[var(--muted)]">Leave keeps the source enrolment active. Graduates end it and create no target enrolment.</span>
          </div>
        </>
      )}
    </div>
  );
}
