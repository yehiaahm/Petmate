import { redirect } from "next/navigation";

/**
 * The members console moved into the data explorer, which adds editing,
 * archiving, export and per-member history. Old links and bookmarks land on
 * the same search there.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();
  if (params.q) next.set("q", params.q.slice(0, 100));
  if (params.status && params.status !== "ALL") next.set("f.status", params.status);
  const qs = next.toString();
  redirect(`/admin/data/users${qs ? `?${qs}` : ""}`);
}
