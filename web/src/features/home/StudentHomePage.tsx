import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchMe } from "@/api/client";

function greeting(firstName?: string) {
  if (!firstName) return "Welcome";
  return `${new Date().getHours() < 12 ? "Good morning" : "Good afternoon"}, ${firstName}`;
}

export function StudentHomePage() {
  const navigate = useNavigate();
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
        <div className="h-9 w-64 animate-pulse rounded bg-[#E4E4E7]" />
        <div className="h-5 w-80 animate-pulse rounded bg-[#E4E4E7]" />
        <div className="h-24 animate-pulse rounded-md border border-[#E4E4E7] bg-white" />
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
      <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">
        {greeting(data.user.firstName)}
      </h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[#71717A]">
        {data.school.name} · {data.school.slug}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-[#E4E4E7] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[#71717A]">Current Session</p>
          <p className="mt-1 text-[16px] font-medium">{data.session?.label ?? "—"}</p>
        </div>
        <div className="rounded-md border border-[#E4E4E7] bg-white px-4 py-3">
          <p className="text-[12px] leading-4 text-[#71717A]">Active Term</p>
          <p className="mt-1 text-[16px] font-medium">{data.activeTerm?.name ?? "—"}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold leading-[18px]">My School</h2>
        <div className="mt-4 rounded-md border border-[#E4E4E7] bg-white px-4 py-4 text-[14px] leading-[18px] text-[#71717A]">
          Your class and subjects are managed by your school. They will appear
          here when the student subjects view is available.
        </div>
      </section>
    </div>
  );
}
