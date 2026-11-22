import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listClasses, listSessions, updateClass, type ClassRecord } from "@/api/client";

export function OwnerClassesPage() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [armLabel, setArmLabel] = useState("");
  const [track, setTrack] = useState<ClassRecord["track"]>("general");
  const [banner, setBanner] = useState<string | null>(null);

  const sessions = useQuery({ queryKey: ["owner-classes", "sessions"], queryFn: listSessions, retry: false });
  const classes = useQuery({
    queryKey: ["owner-classes", "classes", sessionId],
    queryFn: () => listClasses(sessionId),
    enabled: Boolean(sessionId),
    retry: false,
  });

  useEffect(() => {
    if (!sessionId && sessions.data?.data.length) setSessionId(sessions.data.data[0]!.id);
  }, [sessionId, sessions.data]);

  const selected = classes.data?.data.find((cls) => cls.id === selectedId);

  useEffect(() => {
    if (selected) {
      setArmLabel(selected.armLabel);
      setTrack(selected.track);
    }
  }, [selected]);

  const mutation = useMutation({
    mutationFn: () => updateClass(selectedId, { armLabel: armLabel.trim(), track }),
    onSuccess: () => {
      setBanner("Class updated.");
      void classes.refetch();
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Could not update class."),
  });

  if (sessions.error || classes.error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold">Classes</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load classes.</span>
          <button type="button" onClick={() => { sessions.refetch(); classes.refetch(); }} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-8">Classes</h1>
          <p className="mt-2 text-[14px] text-[var(--muted)]">Review and edit class arm labels and tracks.</p>
        </div>
        <label className="block text-[14px]">
          <span className="mb-1 block font-medium">Session</span>
          <select className="h-10 rounded-md border border-[var(--border-strong)] bg-white px-3" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setSelectedId(""); }}>
            {sessions.data?.data.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
        </label>
      </div>

      {banner && <p className="mt-4 rounded-md border border-[var(--border)] bg-white px-4 py-3 text-[14px]">{banner}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
          {classes.isLoading ? (
            <p className="px-4 py-6 text-[14px] text-[var(--muted)]">Loading classes...</p>
          ) : (classes.data?.data.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-[14px] text-[var(--muted)]">No classes in this session. Create one in School Setup.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {classes.data!.data.map((cls) => (
                <button key={cls.id} type="button" onClick={() => setSelectedId(cls.id)} className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--surface-muted)] ${cls.id === selectedId ? "bg-[var(--accent-soft)]" : ""}`}>
                  <span>
                    <span className="block text-[14px] font-medium">{cls.level.name} {cls.armLabel}</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--muted)]">{cls.track}</span>
                  </span>
                  <span className="text-[12px] text-[var(--accent)]">Edit</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-[var(--border)] bg-white p-4">
          {!selected ? (
            <p className="text-[14px] text-[var(--muted)]">Select a class to edit it.</p>
          ) : (
            <div className="space-y-4">
              <h2 className="text-[14px] font-semibold">{selected.level.name} · editing</h2>
              <label className="block text-[14px]">
                <span className="block font-medium">Arm label</span>
                <input className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] px-3" value={armLabel} onChange={(e) => setArmLabel(e.target.value)} />
              </label>
              <label className="block text-[14px]">
                <span className="block font-medium">Track</span>
                <select className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3" value={track} onChange={(e) => setTrack(e.target.value as ClassRecord["track"])}>
                  <option value="general">General</option>
                  <option value="science">Science</option>
                  <option value="arts">Arts</option>
                  <option value="commercial">Commercial</option>
                </select>
              </label>
              <button type="button" disabled={mutation.isPending || !armLabel.trim()} onClick={() => mutation.mutate()} className="h-9 w-full rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
                {mutation.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
