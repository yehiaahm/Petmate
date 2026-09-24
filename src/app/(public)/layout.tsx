import { Header } from "@/components/shell/header";
import { Footer } from "@/components/shell/footer";
import { BottomNav } from "@/components/shell/bottom-nav";
import { getAuth } from "@/lib/auth/session";
import { totalUnread } from "@/lib/services/chat.service";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  const unread = auth ? await totalUnread(auth.user.id) : 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      {/* Bottom padding clears the mobile tab bar so nothing is ever hidden. */}
      <main id="main" className="flex-1 pb-20 md:pb-0">
        {children}
      </main>
      <Footer />
      <BottomNav signedIn={Boolean(auth)} unread={unread} />
    </div>
  );
}
