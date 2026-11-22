import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchClassRoster } from "@/api/client";

export function StudentDetailPage() {
  const { classId, studentId } = useParams({ strict: false }) as {
    classId: string;
    studentId: string;
  };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["roster", classId],
    queryFn: () => fetchClassRoster(classId, { limit: 100 }),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1040px] space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-[#E4E4E7]" />
        <div className="h-28 animate-pulse rounded-md border border-[#E4E4E7] bg-white" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <Link to="/app/classes/$classId" params={{ classId }} className="text-[14px] text-[#71717A] hover:text-[#18181B]">
          ← Class Roster
        </Link>
        <div className="mt-6 flex items-center justify-between rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] text-[#B91C1C]">
          <span>We could not load this student.</span>
          <button type="button" onClick={() => refetch()} className="h-9 rounded-lg border border-[#FCA5A5] bg-white px-4 font-medium">Retry</button>
        </div>
      </div>
    );
  }

  const student = data?.data.find((row) => row.studentId === studentId);
  if (!student) {
    return (
      <div className="mx-auto max-w-[1040px]">
        <Link to="/app/classes/$classId" params={{ classId }} className="text-[14px] text-[#71717A] hover:text-[#18181B]">
          ← Class Roster
        </Link>
        <div className="mt-6 rounded-md border border-[#E4E4E7] bg-white px-6 py-10 text-center text-[14px] text-[#71717A]">
          This student is not in the current roster page.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <Link to="/app/classes/$classId" params={{ classId }} className="text-[14px] text-[#71717A] hover:text-[#18181B]">
        ← Class Roster
      </Link>
      <div className="mt-4 rounded-md border border-[#E4E4E7] bg-white p-6">
        <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">
          {student.firstName} {student.lastName}
        </h1>
        <p className="mt-1 text-[14px] text-[#71717A]">{student.admissionNumber}</p>
        <span className={`mt-3 inline-flex rounded border px-2 py-0.5 text-[12px] ${student.complete ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"}`}>
          {student.complete ? "Selection complete" : "Selection incomplete"}
        </span>

        <h2 className="mt-6 text-[14px] font-semibold">Subjects</h2>
        <div className="mt-3 divide-y divide-[#E4E4E7] rounded-md border border-[#E4E4E7]">
          {student.subjects.length === 0 ? (
            <p className="px-4 py-3 text-[14px] text-[#71717A]">No subjects recorded.</p>
          ) : (
            student.subjects.map((subject) => (
              <div key={`${subject.subjectId}-${subject.offeringId ?? "extra"}`} className="flex items-center justify-between px-4 py-3 text-[14px]">
                <span className="font-medium text-[#18181B]">{subject.name}</span>
                <span className="text-[12px] text-[#71717A]">{subject.isCompulsory ? "Compulsory" : "Elective"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
