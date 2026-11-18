import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { fetchMe, logoutRequest } from "../api/client";

export function AppPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSuccess: () => {
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  if (isLoading || !data) return null;

  return (
    <div className="mx-auto mt-12 max-w-md space-y-2 rounded-lg border border-gray-200 bg-white p-6 text-sm shadow-sm">
      <p>
        <strong>School:</strong> {data.school.name}
      </p>
      <p>
        <strong>Signed in as:</strong> {data.user.firstName}{" "}
        {data.user.lastName}
      </p>
      <p>
        <strong>Role:</strong> {data.roles.join(", ")}
      </p>
      <p>
        <strong>Session:</strong> {data.session?.label ?? "none"}
      </p>
      <p>
        <strong>Term:</strong> {data.activeTerm?.name ?? "none"}
      </p>

      <button
        type="button"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {logoutMutation.isPending ? "Logging out..." : "Logout"}
      </button>
    </div>
  );
}

export function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <nav className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="font-semibold">GiftedMind</span>
          <div className="flex gap-4 text-sm">
            <Link to="/login" className="text-gray-600 hover:text-gray-900">
              Login
            </Link>
            <Link to="/app" className="text-gray-600 hover:text-gray-900">
              App
            </Link>
          </div>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
