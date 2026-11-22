import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createClass,
  listClasses,
  listLevels,
  listSessions,
  updateClass,
  type ClassRecord,
} from "@/api/client";


function trackOptions(stage: "junior" | "senior") {
  return stage === "junior"
    ? [{ value: "general" as const, label: "General" }]
    : [
        { value: "science" as const, label: "Science" },
        { value: "arts" as const, label: "Arts" },
        { value: "commercial" as const, label: "Commercial" },
      ];
}

export function OwnerClassesPage() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [armLabel, setArmLabel] = useState("");
  const [track, setTrack] = useState<ClassRecord["track"]>("general");
  const [banner, setBanner] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newLevelId, setNewLevelId] = useState("");
  const [newArmLabel, setNewArmLabel] = useState("");
  const [newTrack, setNewTrack] = useState<ClassRecord["track"]>("general");

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

  const levels = useQuery({
    queryKey: ["owner-classes", "levels"],
    queryFn: listLevels,
    enabled: showCreate,
    retry: false,
  });
  const selected = classes.data?.data.find((cls) => cls.id === selectedId);

  useEffect(() => {
    if (showCreate && !newLevelId && levels.data?.data.length) {
      setNewLevelId(levels.data.data[0]!.id);
    }
  }, [showCreate, newLevelId, levels.data]);

  const newLevel = levels.data?.data.find((level) => level.id === newLevelId);
  const newTrackOptions = newLevel ? trackOptions(newLevel.stage) : [];

  useEffect(() => {
    if (!newLevel) return;
    const allowed = trackOptions(newLevel.stage);
    if (!allowed.some((option) => option.value === newTrack)) {
      setNewTrack(allowed[0]!.value);
    }
  }, [newLevel, newTrack]);

  useEffect(() => {
    if (selected) {
      setArmLabel(selected.armLabel);
      setTrack(selected.track);
    }
  }, [selected]);

  const createMutation = useMutation({
    mutationFn: () =>
      createClass({
        sessionId,
        levelId: newLevelId,
        armLabel: newArmLabel.trim(),
        track: newTrack,
      }),
    onSuccess: (data) => {
      setBanner("Class created.");
      setShowCreate(false);
      setNewArmLabel("");
      setSelectedId(data.class.id);
      void classes.refetch();
    },
    onError: (error) =>
      setBanner(error instanceof Error ? error.message : "Could not create class."),
  });

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
          <p className="mt-2 text-[14px] text-[var(--muted)]">Create classes, then review and edit arm labels and tracks.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-[14px]">
            <span className="mb-1 block font-medium">Session</span>
            <select className="h-10 rounded-md border border-[var(--border-strong)] bg-white px-3" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setSelectedId(""); }}>
              {sessions.data?.data.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setShowCreate((value) => !value)} className="h-10 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)]">
            {showCreate ? "Cancel" : "Create class"}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mt-4 rounded-md border border-[var(--border)] bg-white p-4">
          <h2 className="text-[14px] font-semibold">Create a class</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-[14px]">
              <span className="block font-medium">Level</span>
              <select className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3" value={newLevelId} onChange={(e) => setNewLevelId(e.target.value)} disabled={levels.isLoading}>
                {levels.data?.data.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
              </select>
            </label>
            <label className="block text-[14px]">
              <span className="block font-medium">Arm label</span>
              <input className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] px-3" placeholder="A" value={newArmLabel} onChange={(e) => setNewArmLabel(e.target.value)} />
            </label>
            <label className="block text-[14px]">
              <span className="block font-medium">Track</span>
              <select className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3" value={newTrack} onChange={(e) => setNewTrack(e.target.value as ClassRecord["track"])}>
                {newTrackOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
                {newLevel?.stage === "junior"
                  ? "Junior classes use the General track."
                  : "Senior classes use Science, Arts, or Commercial."}
              </p>
            </label>
          </div>
          {levels.error && <p className="mt-2 text-[12px] text-[#B91C1C]">Could not load levels.</p>}
          <button type="button" disabled={createMutation.isPending || !newLevelId || !newArmLabel.trim() || !sessionId} onClick={() => createMutation.mutate()} className="mt-3 h-9 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
            {createMutation.isPending ? "Creating..." : "Create class"}
          </button>
        </div>
      )}

      {banner && <p className="mt-4 rounded-md border border-[var(--border)] bg-white px-4 py-3 text-[14px]">{banner}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
          {classes.isLoading ? (
            <p className="px-4 py-6 text-[14px] text-[var(--muted)]">Loading classes...</p>
          ) : (classes.data?.data.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-[14px] text-[var(--muted)]">No classes in this session. Use Create class to create one.</p>
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
                  {trackOptions(selected.level.stage).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
