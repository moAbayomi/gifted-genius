import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitPromotionPlan,
  listSessions,
  previewPromotion,
  type PromotionPreview,
} from "@/api/client";

function statusTone(action: PromotionPreview["rows"][number]["action"]) {
  if (action === "promote") return "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]";
  if (action === "graduate") return "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]";
  return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
}

export function PromotionPage() {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof commitPromotionPlan>> | null>(null);

  const sessions = useQuery({ queryKey: ["promotion", "sessions"], queryFn: listSessions, retry: false });
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

  const commit = useMutation({
    mutationFn: () => {
      const rows = (preview.data?.rows ?? [])
        .filter((row) => row.action === "promote" && row.targetClassId)
        .map((row) => ({
          enrollmentId: row.enrollmentId,
          targetClassId: row.targetClassId,
        }));
      return commitPromotionPlan(sourceId, targetId, rows);
    },
    onSuccess: (data) => {
      setResult(data);
      setBanner(null);
      void queryClient.invalidateQueries({ queryKey: ["promotion"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Promotion failed."),
  });

  if (sessions.isLoading) {
    return <div className="mx-auto max-w-[1040px]"><div className="h-8 w-48 animate-pulse rounded bg-[#E4E4E7]" /><div className="mt-6 h-40 animate-pulse rounded-md border border-[#E4E4E7] bg-white" /></div>;
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
  const promotable = preview.data?.rows.filter((row) => row.action === "promote" && row.targetClassId) ?? [];

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">Promotion</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[#71717A]">
        Preview where active students will move next session, then commit the plan. Nothing is written until you commit.
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
          <select className="mt-1.5 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3" value={sourceId} onChange={(e) => { setSourceId(e.target.value); setResult(null); }}>
            <option value="">Select source</option>
            {sessionList.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
        </label>
        <label className="block text-[14px]">
          <span className="font-medium">Target session</span>
          <select className="mt-1.5 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3" value={targetId} onChange={(e) => { setTargetId(e.target.value); setResult(null); }}>
            <option value="">Select target</option>
            {sessionList.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
        </label>
      </div>

      {preview.isLoading && <p className="mt-6 text-[14px] text-[#71717A]">Building preview...</p>}
      {preview.error && <div className="mt-6 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] text-[#B91C1C]">Could not build the promotion preview.</div>}
      {preview.data && (
        <>
          <div className="mt-6 flex flex-wrap gap-2 text-[12px] text-[#71717A]">
            {Object.entries(preview.data.counts).map(([key, value]) => (
              <span key={key} className="rounded border border-[#E4E4E7] bg-white px-2 py-1">{key}: {value}</span>
            ))}
          </div>
          {preview.data.rows.length === 0 ? (
            <div className="mt-4 rounded-md border border-[#E4E4E7] bg-white px-6 py-8 text-center text-[14px] text-[#71717A]">No active enrolments in the source session.</div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border border-[#E4E4E7] bg-white">
              <div className="divide-y divide-[#E4E4E7]">
                {preview.data.rows.map((row) => (
                  <div key={row.enrollmentId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[14px] font-medium">{row.studentId.slice(0, 8)} · {row.action.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-[12px] text-[#71717A]">
                        {row.targetClassId ? `Target class ${row.targetClassId.slice(0, 8)}` : row.warnings.join(", ") || "No target"}
                      </p>
                    </div>
                    <span className={`inline-flex w-fit rounded border px-2 py-0.5 text-[12px] ${statusTone(row.action)}`}>{row.action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" disabled={commit.isPending || promotable.length === 0} onClick={() => commit.mutate()} className="h-10 rounded-md bg-[#2563EB] px-4 text-[14px] font-medium text-white disabled:opacity-60">
              {commit.isPending ? "Committing..." : `Commit ${promotable.length} promotions`}
            </button>
            <span className="text-[12px] text-[#71717A]">Graduates and missing/archived targets are not committed.</span>
          </div>
        </>
      )}
    </div>
  );
}
