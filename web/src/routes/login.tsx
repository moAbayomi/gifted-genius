import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  loginRequest,
  type LoginPayload,
  type LoginResponse,
} from "../api/client";

type SchoolOption = Extract<
  LoginResponse,
  { kind: "select_school" }
>["schools"][number];

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [schoolSlug, setSchoolSlug] = useState("");
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

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
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmed = loginId.trim();
    if (!trimmed) {
      setFormError("Enter your email or username.");
      return;
    }
    if (!trimmed.includes("@") && !schoolSlug.trim()) {
      setFormError("School slug is required for username login.");
      return;
    }

    mutation.mutate(buildPayload());
  }

  function selectSchool(school: SchoolOption) {
    setFormError(null);
    mutation.mutate(buildPayload(school.slug));
  }

  const errorMessage = formError ?? mutation.error?.message;

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Sign in</h1>

      {errorMessage && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {schools.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Select a school to continue:</p>
          {schools.map((school) => (
            <button
              key={school.slug}
              type="button"
              disabled={mutation.isPending}
              onClick={() => selectSchool(school)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-left text-sm font-medium hover:bg-gray-50"
            >
              {school.name}
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Email or Username
            </label>
            <input
              type="text"
              autoComplete="username"
              required
              placeholder="you@school.edu or student.username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              School slug (required for username)
            </label>
            <input
              type="text"
              autoComplete="off"
              placeholder="demo"
              value={schoolSlug}
              onChange={(e) => setSchoolSlug(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-xs text-gray-500">
            Students log in with their username and school slug.
          </p>
        </form>
      )}
    </div>
  );
}
