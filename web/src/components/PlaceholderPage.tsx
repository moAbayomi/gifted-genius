import { Link } from "@tanstack/react-router";

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">{title}</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[#71717A]">{description}</p>
      <Link
        to="/app"
        className="mt-6 inline-flex h-9 items-center rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium text-[#18181B] hover:bg-[#F4F4F5]"
      >
        Back to Home
      </Link>
    </div>
  );
}
