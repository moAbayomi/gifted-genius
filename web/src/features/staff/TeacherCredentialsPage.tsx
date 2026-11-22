import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { clearPendingInvite, getPendingInvite } from "@/api/invite-store";

export function TeacherCredentialsPage() {
  const invite = getPendingInvite();
  const [copied, setCopied] = useState(false);

  if (!invite) {
    return (
      <div className="mx-auto max-w-[560px]">
        <div className="rounded-xl border border-[var(--border)] bg-white p-6 sm:p-8">
          <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">
            No pending invitation
          </h1>
          <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
            Invite a teacher to generate a one-time password.
          </p>
          <Link
            to="/app/staff/new"
            className="mt-5 inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Invite teacher
          </Link>
        </div>
      </div>
    );
  }

  const name = `${invite.user.firstName} ${invite.user.lastName}`.trim();
  const password = invite.temporaryPassword;

  async function copyPassword() {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="rounded-xl border border-[var(--border)] bg-white p-6 sm:p-8">
        <p className="text-[12px] font-medium uppercase tracking-wide text-[#15803D]">
          Teacher invited
        </p>
        <h1 className="mt-2 text-[24px] font-semibold leading-8 text-[var(--text)]">
          {name}
        </h1>
        <p className="mt-1 text-[14px] leading-[18px] text-[var(--muted)]">
          {invite.user.email ?? invite.user.username}
        </p>

        {password ? (
          <>
            <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
              <p className="text-[12px] font-medium leading-4 text-[var(--muted)]">
                Temporary password
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <code className="break-all text-[16px] font-medium leading-6 text-[var(--text)]">
                  {password}
                </code>
                <button
                  type="button"
                  onClick={copyPassword}
                  className="h-8 shrink-0 rounded-md border border-[var(--border-strong)] bg-white px-3 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-4 text-[#B45309]">
              This password is shown once. Ask the teacher to change it at first
              login.
            </p>
          </>
        ) : (
          <p className="mt-6 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[14px] leading-[18px] text-[#92400E]">
            This person already had an account and was linked to the school. No
            temporary password was created.
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Link
            to="/app/staff/new"
            onClick={() => clearPendingInvite()}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] bg-white px-4 text-[14px] font-medium text-[var(--text)] hover:bg-[var(--bg)]"
          >
            Create another
          </Link>
          <Link
            to="/app/staff"
            onClick={() => clearPendingInvite()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Done
          </Link>
        </div>
      </div>
    </div>
  );
}
