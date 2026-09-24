"use client";

import { Copy, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";

/** The invite link, with the ways people in Egypt actually share one. */
export function InviteLink({ link, message }: { link: string; message: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const text = `${message} ${link}`;

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: "PetMate", text: message, url: link }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(link);
      toast.success(t("Link copied"));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input readOnly value={link} dir="ltr" aria-label={t("Your invite link")} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success(t("Link copied")))}
        >
          <Copy className="size-4" aria-hidden />
          {t("Copy")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] bg-[#25D366] px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          <MessageCircle className="size-4" aria-hidden />
          {t("Share on WhatsApp")}
        </a>
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] bg-[#1877F2] px-4 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("Share on Facebook")}
        </a>
        <Button variant="ghost" onClick={() => void share()}>
          <Share2 className="size-4" aria-hidden />
          {t("More")}
        </Button>
      </div>
    </div>
  );
}
