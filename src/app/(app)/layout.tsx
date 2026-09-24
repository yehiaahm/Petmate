import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { totalUnread } from "@/lib/services/chat.service";
import { Header } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Alert } from "@/components/ui/primitives";
import { ResendVerification } from "@/components/auth/resend-verification";

/**
 * Authenticated shell.
 *
 * Auth is enforced here rather than in every page, so a new page under this
 * segment cannot accidentally ship without a check. The `next` parameter means
 * a signed-out visitor lands where they were trying to go.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  if (!auth) redirect("/login?next=/dashboard");

  const unread = await totalUnread(auth.user.id);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <Header />

      {auth.user.status === "SUSPENDED" && (
        <div className="container-page pt-4">
          <Alert tone="danger" title="Your account is suspended">
            You can still read your data, but you cannot list, message or transact. Contact
            support if you believe this is a mistake.
          </Alert>
        </div>
      )}

      {!auth.user.emailVerified && (
        <div className="container-page pt-4">
          <Alert tone="warning" title="Confirm your email address">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                You need a confirmed address before you can message sellers, list a pet or buy
                anything.
              </span>
              <div className="shrink-0 sm:w-56">
                <ResendVerification variant="outline" label="Resend the link" />
              </div>
            </div>
          </Alert>
        </div>
      )}

      <main id="main" className="flex-1 pb-20 md:pb-8">
        {children}
      </main>

      <BottomNav signedIn unread={unread} />
    </div>
  );
}
