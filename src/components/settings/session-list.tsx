"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Monitor, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/utils";

export interface SessionRow {
  id: string;
  ip: string | null;
  device: string;
  current: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(sessionId: string) {
    setBusy(sessionId);
    try {
      await api.post("/api/account", { action: "revoke-session", sessionId });
      toast.success("Device signed out");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not sign that device out",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function revokeAll() {
    setBusy("all");
    try {
      await api.post("/api/account", { action: "revoke-all-sessions" });
      toast.success("All other devices signed out");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not sign the other devices out",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div>
      <ul className="divide-y divide-[var(--border)]">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 py-3">
            <Monitor className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg">{session.device}</span>
                {session.current && (
                  <Badge tone="success" size="sm">
                    This device
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-fg-subtle">
                {session.ip ?? "Unknown address"} · last active{" "}
                {relativeTime(new Date(session.lastSeenAt ?? session.createdAt))}
              </p>
            </div>
            {!session.current && (
              <Button
                variant="ghost"
                size="sm"
                loading={busy === session.id}
                loadingText="…"
                onClick={() => void revoke(session.id)}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>

      {others > 0 && (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            loading={busy === "all"}
            loadingText="Signing out…"
            onClick={() => void revokeAll()}
          >
            <ShieldOff className="size-4" aria-hidden />
            Sign out all other devices
          </Button>
        </div>
      )}
    </div>
  );
}
