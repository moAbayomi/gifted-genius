import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { ChangePasswordPage } from "@/features/auth/ChangePasswordPage";
import { AppLayout } from "@/app/layouts/AppShell";
import { HomePage } from "@/features/home/HomePage";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { StaffPage } from "@/features/staff/StaffPage";
import { InviteTeacherPage } from "@/features/staff/InviteTeacherPage";
import { TeacherCredentialsPage } from "@/features/staff/TeacherCredentialsPage";
import { ClassesRoutePage } from "@/features/classes/ClassesPage";
import { RosterPage } from "@/features/classes/RosterPage";
import { StudentDetailPage } from "@/features/classes/StudentDetailPage";
import { SetupWizardPage } from "@/features/setup/SetupWizardPage";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { EnrollmentPage } from "@/features/enrollment/EnrollmentPage";
import { PromotionPage } from "@/features/promotion/PromotionPage";
import { StudentImportPage } from "@/features/import/StudentImportPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { ApiError, fetchMe } from "@/api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/app" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: HomePage,
});

const staffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/staff",
  component: StaffPage,
});

const inviteTeacherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/staff/new",
  component: InviteTeacherPage,
});

const teacherCredentialsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/staff/new/success",
  component: TeacherCredentialsPage,
});

const classesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/classes",
  component: ClassesRoutePage,
});

const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/classes/$classId",
  component: RosterPage,
});

const studentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/classes/$classId/students/$studentId",
  component: StudentDetailPage,
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/audit",
  component: () => (
    <PlaceholderPage
      title="Audit Log"
      description="Audit review is coming next. The owner home is the first slice."
    />
  ),
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/setup",
  component: SetupWizardPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/calendar",
  component: CalendarPage,
});

const enrollmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/enrollment",
  component: EnrollmentPage,
});

const promotionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/promotion",
  component: PromotionPage,
});

const studentImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/import",
  component: StudentImportPage,
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/change-password",
  beforeLoad: async ({ context }) => {
    let me;
    try {
      me = await context.queryClient.ensureQueryData({
        queryKey: ["me"],
        queryFn: fetchMe,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({ to: "/login" });
      }
      throw err;
    }

    if (!me.mustChangePassword) {
      throw redirect({ to: "/app" });
    }
  },
  component: ChangePasswordPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  appRoute,
  staffRoute,
  inviteTeacherRoute,
  teacherCredentialsRoute,
  classesRoute,
  rosterRoute,
  studentDetailRoute,
  auditRoute,
  setupRoute,
  calendarRoute,
  enrollmentRoute,
  promotionRoute,
  studentImportRoute,
  changePasswordRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
