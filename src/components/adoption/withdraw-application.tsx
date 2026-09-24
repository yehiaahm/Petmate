"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

export function WithdrawApplication({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function withdraw() {
    setWorking(true);
    try {
      await api.post("/api/adoption", { action: "withdraw", applicationId });
      toast.success("Application withdrawn", "The rescue has been told, so they can move on.");
      router.refresh();
    } catch (err) {
      toast.error(
        "Could not withdraw",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    } finally {
      setWorking(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-fg-muted">Sure?</span>
      <Button variant="danger" size="sm" loading={working} onClick={withdraw}>
        Withdraw
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </span>
  );
}
