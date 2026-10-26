// For login lookup — email
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

// For slug generation — school names → URL slugs
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}
