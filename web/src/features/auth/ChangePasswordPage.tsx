import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ApiError,
  changePasswordRequest,
  logoutRequest,
  type ChangePasswordPayload,
} from "@/api/client";

type FieldErrors = Partial<
  Record<"currentPassword" | "newPassword" | "confirmPassword", string>
>;

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.1 0 8.4 4.2 9.4 6.1.2.4.2.8 0 1.2a16 16 0 01-2.6 3.4M6.3 6.3A16.8 16.8 0 002.6 12c.2.4 2.9 6.1 9.4 6.1 1.1 0 2.1-.2 3-.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PasswordInput({
  id,
  label,
  autoComplete,
  value,
  onChange,
  error,
  helper,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[14px] font-medium leading-[18px] text-[#18181B]"
      >
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          className={`h-9 w-full border bg-white px-2 py-1.5 pr-10 text-[14px] leading-[18px] outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 ${
            error
              ? "border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/15"
              : "border-[#D1D5DB]"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-[#71717A] hover:text-[#18181B]"
        >
          <EyeIcon open={visible} />
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">{error}</p>
      ) : helper ? (
        <p className="mt-1 text-[12px] leading-4 text-[#71717A]">{helper}</p>
      ) : null}
    </div>
  );
}

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: (payload: ChangePasswordPayload) =>
      changePasswordRequest(payload),
    onSuccess: async () => {
      // A forced password change ends the current session too: the user must
      // re-authenticate with the new password.
      try {
        await logoutRequest();
      } finally {
        queryClient.clear();
        navigate({ to: "/login" });
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        const mapped: FieldErrors = {};
        if (err.fields.currentPassword)
          mapped.currentPassword = err.fields.currentPassword;
        if (err.fields.newPassword) mapped.newPassword = err.fields.newPassword;
        setFieldErrors(mapped);
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSuccess: () => {
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!currentPassword) errors.currentPassword = "Current password is required";
    if (!newPassword) {
      errors.newPassword = "New password is required";
    } else if (newPassword.length < 10) {
      errors.newPassword = "Use at least 10 characters";
    } else if (newPassword === currentPassword) {
      errors.newPassword = "New password must differ from the current one";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Confirm your new password";
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }
    return errors;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    mutation.mutate({ currentPassword, newPassword });
  }

  const apiError = mutation.error;
  const errorMessage = apiError
    ? apiError instanceof ApiError
      ? apiError.status === 401
        ? "Current password is incorrect."
        : apiError.status === 429
          ? "Too many attempts. Try again in 15 minutes."
          : apiError.message
      : "Unable to connect to GiftedMind servers. Check your internet connection and try again."
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F4F5] px-6 py-12">
      <div className="w-full max-w-[440px] rounded-xl border border-[#E4E4E7] bg-white p-8 shadow-[0_4px_16px_rgba(0,0,0,0.05)]">
        <div className="rounded-lg border border-[#E4E4E7] px-4 py-3">
          <h1 className="text-[20px] font-medium leading-6 text-[#18181B]">
            Change Password
          </h1>
          <p className="mt-5 text-[14px] leading-[18px] text-[#71717A]">
            You signed in with a temporary password. Create a new password to
            continue to your workspace.
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-2 py-3 text-[12px] leading-4 text-[#B91C1C]"
            >
              {errorMessage}
            </div>
          )}

          <form id="change-password-form" onSubmit={handleSubmit} noValidate className="mt-5 space-y-5">
            <PasswordInput
              id="current-password"
              label="Current Password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
              error={fieldErrors.currentPassword}
            />
            <PasswordInput
              id="new-password"
              label="New Password"
              autoComplete="new-password"
              value={newPassword}
              onChange={setNewPassword}
              error={fieldErrors.newPassword}
              helper="Minimum 10 characters"
            />
            <PasswordInput
              id="confirm-password"
              label="Confirm new Password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              error={fieldErrors.confirmPassword}
            />
          </form>
        </div>

        <button
          type="submit"
          form="change-password-form"
          disabled={mutation.isPending}
          className="mt-5 h-9 w-full rounded-xl bg-[#2563EB] text-[14px] leading-[18px] text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? "Updating Password..." : "Update Password"}
        </button>

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="text-[14px] leading-[18px] text-[#B91C1C] hover:text-[#991B1B] disabled:opacity-60"
          >
            {logoutMutation.isPending ? "Signing out..." : "Sign Out Instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
