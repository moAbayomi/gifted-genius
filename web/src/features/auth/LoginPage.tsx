import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ApiError,
  loginRequest,
  type LoginPayload,
  type LoginResponse,
} from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  return (
    <div className="flex min-h-screen items-start justify-center bg-[var(--bg)] px-6 pt-[222px] sm:items-center sm:px-4 sm:py-12">
      <Card
        className={`w-full rounded-none border-0 bg-transparent p-0 shadow-none sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-8 sm:shadow-[var(--shadow-card)] ${
          schools.length > 0 ? "max-w-[440px]" : "max-w-[400px]"
        }`}
      >
        <h1 className="text-[20px] font-medium leading-6 text-foreground">
          Sign in to GiftedMind
        </h1>
        <p className="mt-3 text-[14px] leading-[18px] text-muted-foreground">
          Enter your school email or student username
        </p>

        {errorMessage && (
          <Alert variant="destructive" className="mt-4 px-2 py-3 text-[12px] leading-4">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {schools.length > 0 ? (
          <div className="mt-5">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {schools.map((school) => (
                <Button
                  key={school.slug}
                  type="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => selectSchool(school)}
                  className="h-auto w-full justify-start rounded-none px-4 py-3 text-left text-[14px] font-medium leading-[18px]"
                >
                  <span>
                    {school.name}
                    <span className="mt-0.5 block text-[14px] font-normal leading-[18px] text-muted-foreground">
                      {school.slug}
                    </span>
                  </span>
                </Button>
              ))}
            </div>

            <div className="mt-5 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  setSchools([]);
                  setFieldErrors({});
                  mutation.reset();
                }}
                className="h-9 bg-[#6B7280] px-4 text-white hover:bg-[#4B5563]"
              >
                Back to Login
              </Button>
            </div>
            {mutation.isPending && (
              <p className="mt-3 text-center text-[12px] leading-4 text-muted-foreground">
                Signing in...
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-2">
            <div className="py-1.5">
              <Label htmlFor="login-identifier" className="text-[14px] font-semibold">
                Username / Email
              </Label>
              <Input
                id="login-identifier"
                type="text"
                autoComplete="username"
                placeholder="user@email.com / username"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                aria-invalid={Boolean(fieldErrors.identifier)}
                className="mt-1.5"
              />
              {fieldErrors.identifier && (
                <p className="mt-1 text-[12px] leading-4 text-destructive">
                  {fieldErrors.identifier}
                </p>
              )}
            </div>

            <div className="py-1.5">
              <Label htmlFor="login-school-slug" className="text-[14px] font-semibold">
                School Slug
              </Label>
              <Input
                id="login-school-slug"
                type="text"
                autoComplete="off"
                placeholder="gifted-genius-academy"
                value={schoolSlug}
                onChange={(e) => setSchoolSlug(e.target.value)}
                aria-invalid={Boolean(fieldErrors.schoolSlug)}
                className="mt-1.5"
              />
              {fieldErrors.schoolSlug && (
                <p className="mt-1 text-[12px] leading-4 text-destructive">
                  {fieldErrors.schoolSlug}
                </p>
              )}
            </div>

            <div className="py-1.5">
              <Label htmlFor="login-password" className="text-[14px] font-semibold">
                Password
              </Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="**********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(fieldErrors.password)}
                className="mt-1.5"
              />
              {fieldErrors.password && (
                <p className="mt-1 text-[12px] leading-4 text-destructive">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={mutation.isPending || rateLimited}
              className="mt-4 h-11 w-full rounded-lg text-[14px] font-normal leading-[18px]"
            >
              {mutation.isPending ? "Signing In..." : "Sign In"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
