import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, changeUsernameRequest, fetchMe } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function greeting(firstName?: string) {
  if (!firstName) return "Welcome";
  return `${new Date().getHours() < 12 ? "Good morning" : "Good afternoon"}, ${firstName}`;
}

export function StudentHomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const usernameMutation = useMutation({
    mutationFn: () =>
      changeUsernameRequest({ currentPassword, username: newUsername.trim() }),
    onSuccess: async (result) => {
      setNewUsername("");
      setCurrentPassword("");
      setUsernameMessage(`Your username is now ${result.username}.`);
      setUsernameError(null);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => {
      setUsernameMessage(null);
      setUsernameError(
        err instanceof ApiError ? err.message : "Could not change your username.",
      );
    },
  });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      navigate({ to: "/login" });
    }
  }, [error, navigate]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px] space-y-4">
        <div className="h-9 w-64 animate-pulse rounded bg-[var(--border)]" />
        <div className="h-5 w-80 animate-pulse rounded bg-[var(--border)]" />
        <div className="h-24 animate-pulse rounded-md border border-[var(--border)] bg-white" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <h1 className="text-[24px] font-semibold leading-8">Welcome</h1>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load your school information.</span>
          <button type="button" onClick={() => refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">
        {greeting(data.user.firstName)}
      </h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        {data.school.name} · {data.school.slug}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[var(--muted)]">Current Session</p>
          <p className="mt-1 text-[16px] font-medium">{data.session?.label ?? "—"}</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[var(--muted)]">Active Term</p>
          <p className="mt-1 text-[16px] font-medium">{data.activeTerm?.name ?? "—"}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold leading-[18px]">Login username</h2>
        <Card className="mt-4 p-4">
          <p className="text-[12px] text-muted-foreground">
            Current username: <span className="font-medium text-foreground">{data.user.username ?? "—"}</span>
          </p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              setUsernameError(null);
              setUsernameMessage(null);
              usernameMutation.mutate();
            }}
          >
            <div>
              <Label htmlFor="new-username" className="text-[14px]">New username</Label>
              <Input
                id="new-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="ada.okafor"
                autoComplete="username"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="username-password" className="text-[14px]">Current password</Label>
              <Input
                id="username-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={
                  usernameMutation.isPending ||
                  newUsername.trim().length < 3 ||
                  currentPassword.length === 0
                }
              >
                {usernameMutation.isPending ? "Saving..." : "Change username"}
              </Button>
            </div>
          </form>
          {usernameMessage && (
            <Alert variant="success" className="mt-3">
              <AlertDescription>{usernameMessage}</AlertDescription>
            </Alert>
          )}
          {usernameError && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{usernameError}</AlertDescription>
            </Alert>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold leading-[18px]">My School</h2>
        <div className="mt-4 rounded-md border border-[var(--border)] bg-white px-4 py-4 text-[14px] leading-[18px] text-[var(--muted)]">
          Your class and subjects are managed by your school. They will appear
          here when the student subjects view is available.
        </div>
      </section>
    </div>
  );
}
