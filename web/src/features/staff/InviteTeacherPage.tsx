import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ApiError,
  createMember,
  fetchMe,
  type CreateUserPayload,
} from "@/api/client";
import { setPendingInvite } from "@/api/invite-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [role, setRole] = useState<"teacher" | "principal">("teacher");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const canCreatePrincipal = me.data?.roles.includes("owner") ?? false;

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
      roleKeys: [role],
    });
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        to="/app/staff"
        className="text-[14px] leading-[18px] text-[var(--muted)] hover:text-[var(--text)]"
      >
        ← Back to Staff
      </Link>

      <Card className="mt-4 p-6 sm:p-8">
        <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">
          Invite Staff
        </h1>
        <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
          Send an invitation to a staff member. The server will generate a temporary
          password for them.
        </p>

        {banner && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          <div>
            <Label htmlFor="first-name" className="text-[14px]">
              First name
            </Label>
            <Input
              id="first-name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.firstName)}
              className="mt-1.5"
            />
            {fieldErrors.firstName && (
              <p className="mt-1 text-[12px] leading-4 text-destructive">{fieldErrors.firstName}</p>
            )}
          </div>

          <div>
            <Label htmlFor="last-name" className="text-[14px]">
              Last name
            </Label>
            <Input
              id="last-name"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.lastName)}
              className="mt-1.5"
            />
            {fieldErrors.lastName && (
              <p className="mt-1 text-[12px] leading-4 text-destructive">{fieldErrors.lastName}</p>
            )}
          </div>

          <div>
            <Label htmlFor="email" className="text-[14px]">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              className="mt-1.5"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-[12px] leading-4 text-destructive">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <Label htmlFor="staff-role" className="text-[14px]">
              Role
            </Label>
            <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as "teacher" | "principal")} className="mt-1.5 h-10 w-full rounded-md border border-[var(--border-strong)] bg-white px-3 text-[14px]">
              <option value="teacher">Teacher</option>
              {canCreatePrincipal && <option value="principal">Principal</option>}
            </select>
            <p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">
              No password is collected here. The server generates one.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <Button asChild variant="outline">
              <Link to="/app/staff">Cancel</Link>
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Sending Invite..." : "Send Invite"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
