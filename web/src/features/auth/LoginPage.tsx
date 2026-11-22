import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ApiError,
  loginRequest,
  type LoginPayload,
  type LoginResponse,
} from "@/api/client";

type SchoolOption = Extract<
  LoginResponse,
  { kind: "select_school" }
>["schools"][number];

type FieldErrors = Partial<
  Record<"identifier" | "schoolSlug" | "password", string>
>;

function mapApiFields(fields?: Record<string, string>): FieldErrors {
  if (!fields) return {};
  const mapped: FieldErrors = {};
  if (fields.email) mapped.identifier = fields.email;
  if (fields.username) mapped.identifier = fields.username;
  if (fields.schoolSlug) mapped.schoolSlug = fields.schoolSlug;
  if (fields.password) mapped.password = fields.password;
  return mapped;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [schoolSlug, setSchoolSlug] = useState("");
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  function buildPayload(slugOverride?: string): LoginPayload {
    const trimmed = loginId.trim();
    const identity = trimmed.includes("@")
      ? { email: trimmed }
      : { username: trimmed };
    const slug = (slugOverride ?? schoolSlug).trim();

    return {
      ...identity,
      password,
      ...(slug ? { schoolSlug: slug } : {}),
    } as LoginPayload;
  }

  const mutation = useMutation({
    mutationFn: (payload: LoginPayload) => loginRequest(payload),
    onSuccess: async (data) => {
      if (data.kind === "select_school") {
        setSchools(data.schools);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/app" });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFieldErrors(mapApiFields(err.fields));
      }
    },
  });

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const trimmed = loginId.trim();

    if (!trimmed) {
      errors.identifier = "Email or username is required";
    }
    if (!trimmed.includes("@") && !schoolSlug.trim()) {
      errors.schoolSlug = "School slug is required";
    }
    if (!password) {
      errors.password = "Password is required";
    }

    return errors;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setGeneralError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    mutation.mutate(buildPayload());
  }

  function selectSchool(school: SchoolOption) {
    setFieldErrors({});
    setGeneralError(null);
    mutation.mutate(buildPayload(school.slug));
  }

  const apiError = mutation.error;
  const rateLimited = apiError instanceof ApiError && apiError.status === 429;
  const validationWithFields =
    apiError instanceof ApiError &&
    apiError.status === 400 &&
    apiError.fields !== undefined;
  const errorMessage =
    generalError ??
    (apiError
      ? apiError instanceof ApiError
        ? apiError.status === 401
          ? "Invalid email or password."
          : apiError.status === 429
            ? "Too many attempts. Try again in 15 minutes."
            : validationWithFields
              ? null
              : apiError.message
        : "Unable to connect to GiftedMind servers. Check your internet connection and try again."
      : null);

  const inputClass = (field: keyof FieldErrors) =>
    `h-9 w-full border bg-white px-2 py-1.5 text-[14px] leading-[18px] outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 ${
      fieldErrors[field]
        ? "border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/15"
        : "border-[#D1D5DB]"
    }`;

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#F4F4F5] px-6 pt-[222px] sm:items-center sm:px-4 sm:py-12">
      <div
        className={`w-full sm:rounded-xl sm:border sm:border-[#E4E4E7] sm:bg-white sm:p-8 sm:shadow-[0_4px_16px_rgba(0,0,0,0.05)] ${
          schools.length > 0 ? "max-w-[440px]" : "max-w-[400px]"
        }`}
      >
        <h1 className="text-[20px] font-medium leading-6 text-[#18181B]">
          Sign in to GiftedMind
        </h1>
        <p className="mt-3 text-[14px] leading-[18px] text-[#71717A]">
          Enter your school email or student username
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-2 py-3 text-[12px] leading-4 text-[#B91C1C]"
          >
            {errorMessage}
          </div>
        )}

        {schools.length > 0 ? (
          <div className="mt-5">
            <div className="overflow-hidden rounded-lg border border-[#E4E4E7] bg-white">
              {schools.map((school) => (
                <button
                  key={school.slug}
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => selectSchool(school)}
                  className="block w-full px-4 py-3 text-left text-[14px] font-medium leading-[18px] text-[#18181B] hover:bg-[#F4F4F5] disabled:cursor-wait disabled:opacity-60"
                >
                  {school.name}
                  <span className="mt-0.5 block text-[14px] font-normal leading-[18px] text-[#71717A]">
                    {school.slug}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-center">
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setSchools([]);
                  setFieldErrors({});
                  mutation.reset();
                }}
                className="h-9 rounded-lg bg-[#6B7280] px-4 text-[14px] leading-[18px] text-white hover:bg-[#4B5563] disabled:opacity-60"
              >
                Back to Login
              </button>
            </div>
            {mutation.isPending && (
              <p className="mt-3 text-center text-[12px] leading-4 text-[#71717A]">
                Signing in...
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-2">
            <div className="py-1.5">
              <label
                htmlFor="login-identifier"
                className="block text-[14px] font-semibold leading-[18px] text-[#18181B]"
              >
                Username / Email
              </label>
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                placeholder="user@email.com / username"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                aria-invalid={Boolean(fieldErrors.identifier)}
                className={`mt-1.5 ${inputClass("identifier")}`}
              />
              {fieldErrors.identifier && (
                <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">
                  {fieldErrors.identifier}
                </p>
              )}
            </div>

            <div className="py-1.5">
              <label
                htmlFor="login-school-slug"
                className="block text-[14px] font-semibold leading-[18px] text-[#18181B]"
              >
                School Slug
              </label>
              <input
                id="login-school-slug"
                type="text"
                autoComplete="off"
                placeholder="gifted-genius-academy"
                value={schoolSlug}
                onChange={(e) => setSchoolSlug(e.target.value)}
                aria-invalid={Boolean(fieldErrors.schoolSlug)}
                className={`mt-1.5 ${inputClass("schoolSlug")}`}
              />
              {fieldErrors.schoolSlug && (
                <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">
                  {fieldErrors.schoolSlug}
                </p>
              )}
            </div>

            <div className="py-1.5">
              <label
                htmlFor="login-password"
                className="block text-[14px] font-semibold leading-[18px] text-[#18181B]"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="**********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                className={`mt-1.5 ${inputClass("password")}`}
              />
              {fieldErrors.password && (
                <p className="mt-1 text-[12px] leading-4 text-[#DC2626]">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={mutation.isPending || rateLimited}
              className="mt-4 h-11 w-full rounded-lg bg-[#2563EB] text-[14px] font-normal leading-[18px] text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? "Signing In..." : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
