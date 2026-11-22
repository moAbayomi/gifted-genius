import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import {
  ApiError,
  createMember,
  type CreateUserPayload,
} from "@/api/client";
import { setPendingInvite } from "@/api/invite-store";

type FieldErrors = Partial<Record<"firstName" | "lastName" | "email", string>>;

function mapFields(fields?: Record<string, string>): FieldErrors {
  if (!fields) return {};
  const mapped: FieldErrors = {};
  if (fields.firstName) mapped.firstName = fields.firstName;
  if (fields.lastName) mapped.lastName = fields.lastName;
  if (fields.email) mapped.email = fields.email;
  return mapped;
}

export function InviteTeacherPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => createMember(payload),
    onSuccess: (data) => {
      setPendingInvite(data);
      navigate({ to: "/app/staff/new/success" });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFieldErrors(mapFields(err.fields));
        if (err.status === 409) {
          setBanner("This user is already a member of this school.");
        } else if (err.status === 403) {
          setBanner("You do not have permission to invite staff.");
        } else if (err.status === 401) {
          navigate({ to: "/login" });
        } else if (err.status >= 500) {
          setBanner("Something went wrong. Please try again.");
        }
      } else {
        setBanner(
          "Unable to connect to GiftedMind servers. Check your internet connection and try again.",
        );
      }
    },
  });

  useEffect(() => {
    if (mutation.error instanceof ApiError && mutation.error.status === 401) {
      navigate({ to: "/login" });
    }
  }, [mutation.error, navigate]);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!firstName.trim()) errors.firstName = "First name is required";
    if (!lastName.trim()) errors.lastName = "Last name is required";
    if (!email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address";
    }
    return errors;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    mutation.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      roleKeys: ["teacher"],
    });
  }

  const inputClass = (field: keyof FieldErrors) =>
    `h-10 w-full rounded-md border bg-white px-3 text-[14px] leading-[18px] outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 ${
      fieldErrors[field]
        ? "border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/15"
        : "border-[#D1D5DB]"
    }`;

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        to="/app/staff"
        className="text-[14px] leading-[18px] text-[#71717A] hover:text-[#18181B]"
      >
        ← Back to Staff
      </Link>

      <div className="mt-4 rounded-xl border border-[#E4E4E7] bg-white p-6 sm:p-8">
        <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">
          Invite Teacher
        </h1>
        <p className="mt-2 text-[14px] leading-[18px] text-[#71717A]">
          Send an invitation to a teacher. The server will generate a temporary
          password for them.
        </p>

        {banner && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] leading-[18px] text-[#B91C1C]"
          >
            {banner}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          <div>
            <label htmlFor="first-name" className="block text-[14px] font-medium leading-[18px] text-[#18181B]">
              First name
            </label>
            <input
              id="first-name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.firstName)}
              className={`mt-1.5 ${inputClass("firstName")}`}
            />
            {fieldErrors.firstName && (
              <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">{fieldErrors.firstName}</p>
            )}
          </div>

          <div>
            <label htmlFor="last-name" className="block text-[14px] font-medium leading-[18px] text-[#18181B]">
              Last name
            </label>
            <input
              id="last-name"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.lastName)}
              className={`mt-1.5 ${inputClass("lastName")}`}
            />
            {fieldErrors.lastName && (
              <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">{fieldErrors.lastName}</p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="block text-[14px] font-medium leading-[18px] text-[#18181B]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              className={`mt-1.5 ${inputClass("email")}`}
            />
            {fieldErrors.email && (
              <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <span className="block text-[14px] font-medium leading-[18px] text-[#18181B]">
              Role
            </span>
            <div className="mt-1.5 flex h-10 items-center rounded-md border border-[#E4E4E7] bg-[#F4F4F5] px-3 text-[14px] leading-[18px] text-[#52525B]">
              Teacher
            </div>
            <p className="mt-1 text-[12px] leading-4 text-[#71717A]">
              No password is collected here. The server generates one.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <Link
              to="/app/staff"
              className="inline-flex h-9 items-center justify-center rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium text-[#18181B] hover:bg-[#F4F4F5]"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[#2563EB] px-4 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? "Sending Invite..." : "Invite Teacher"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
