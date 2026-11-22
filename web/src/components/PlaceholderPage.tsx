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
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">{title}</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">{description}</p>
      <Link
        to="/app"
        className="mt-6 inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] bg-white px-4 text-[14px] font-medium text-[var(--text)] hover:bg-[var(--bg)]"
      >
        Back to Home
      </Link>
    </div>
  );
}
