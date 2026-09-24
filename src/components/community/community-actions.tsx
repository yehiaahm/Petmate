"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Plus, Trash2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { SPECIES, SPECIES_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Sends a signed-out visitor to sign in instead of showing them an error. */
function useAction() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  return async function run<T>(body: Record<string, unknown>): Promise<T | null> {
    try {
      return await api.post<T>("/api/community", body);
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return null;
      }
      toast.error(t("That did not work"), err instanceof ApiError ? err.message : t("Please try again."));
      return null;
    }
  };
}

export function JoinButton({ groupId, joined, owner }: { groupId: string; joined: boolean; owner?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const run = useAction();
  const [busy, setBusy] = useState(false);

  if (owner) return null;

  async function toggle() {
    setBusy(true);
    const result = await run({ action: joined ? "leave" : "join", groupId });
    setBusy(false);
    if (result) router.refresh();
  }

  return (
    <Button variant={joined ? "outline" : "primary"} size="sm" loading={busy} onClick={() => void toggle()}>
      {joined ? t("Leave group") : t("Join group")}
    </Button>
  );
}

export function LikeButton({
  targetType,
  targetId,
  liked: initialLiked,
  count: initialCount,
}: {
  targetType: "POST" | "COMMENT";
  targetId: string;
  liked: boolean;
  count: number;
}) {
  const { t, fmt } = useI18n();
  const run = useAction();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    // Optimistic, then corrected to whatever the server counted.
    setLiked(!liked);
    setCount((c) => c + (liked ? -1 : 1));
    const result = await run<{ liked: boolean; likeCount: number }>({ action: "like", targetType, targetId });
    if (result) {
      setLiked(result.liked);
      setCount(result.likeCount);
    } else {
      setLiked(liked);
      setCount(initialCount);
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={liked}
      aria-label={liked ? t("Unlike") : t("Like")}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm transition-colors",
        liked ? "text-[var(--danger)]" : "text-fg-subtle hover:text-fg-muted",
      )}
    >
      <Heart className={cn("size-4", liked && "fill-current")} aria-hidden />
      <span className="tabular">{fmt.number(count)}</span>
    </button>
  );
}

export function RemoveButton({ kind, id, redirectTo }: { kind: "post" | "comment"; id: string; redirectTo?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const run = useAction();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const result = await run(kind === "post" ? { action: "remove-post", postId: id } : { action: "remove-comment", commentId: id });
    setBusy(false);
    setConfirming(false);
    if (!result) return;
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 text-sm text-fg-subtle transition-colors hover:text-[var(--danger)]"
      >
        <Trash2 className="size-3.5" aria-hidden />
        {t("Delete")}
      </button>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={kind === "post" ? t("Delete this post?") : t("Delete this comment?")}
        description={t("It will no longer be visible to anyone.")}
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("Delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function CreateGroupButton({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [species, setSpecies] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { group } = await api.post<{ group: { slug: string } }>("/api/community", {
        action: "create-group",
        group: { name, description: description || undefined, species: species || undefined, rules: rules || undefined },
      });
      router.push(`/community/${group.slug}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => (signedIn ? setOpen(true) : router.push("/login?next=/community"))}>
        <Plus className="size-4" aria-hidden />
        {t("Start a group")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("Start a group")}
        description={t("Groups are public: anyone can read them, and members can post.")}
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t("Name")} required>
            {({ id }) => <Input id={id} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Golden Retriever owners in Cairo")} />}
          </Field>
          <Field label={t("What is it about?")}>
            {({ id }) => <Textarea id={id} rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <Field label={t("Species")}>
            {({ id }) => (
              <Select id={id} value={species} onChange={(e) => setSpecies(e.target.value)}>
                <option value="">{t("All pets")}</option>
                {SPECIES.map((s) => (
                  <option key={s} value={s}>
                    {t(SPECIES_LABEL[s])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("Group rules (optional)")}>
            {({ id }) => <Textarea id={id} rows={3} maxLength={1500} value={rules} onChange={(e) => setRules(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button loading={busy} disabled={name.trim().length < 3} onClick={() => void create()}>
              {t("Create group")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function PostComposer({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const run = useAction();
  const [type, setType] = useState("DISCUSSION");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const types: { value: string; label: string }[] = [
    { value: "DISCUSSION", label: t("Discussion") },
    { value: "QUESTION", label: t("Question") },
    { value: "MILESTONE", label: t("Milestone") },
    { value: "LOST_FOUND", label: t("Lost or found pet") },
  ];

  async function submit() {
    setBusy(true);
    const result = await run<{ post: { id: string } }>({
      action: "post",
      post: { groupId, type, title: title || undefined, body },
    });
    setBusy(false);
    if (!result) return;
    setTitle("");
    setBody("");
    toast.success(t("Posted"));
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Select aria-label={t("Post type")} value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Input aria-label={t("Title (optional)")} placeholder={t("Title (optional)")} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <Textarea aria-label={t("Write something")} placeholder={t("Share a question, a tip or news with the group…")} rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">{t("Never agree to pay anyone outside PetMate. Report anyone who asks.")}</p>
        <Button size="sm" loading={busy} disabled={body.trim().length < 2} onClick={() => void submit()}>
          {t("Post")}
        </Button>
      </div>
    </div>
  );
}

export function CommentForm({ postId, parentId, onDone }: { postId: string; parentId?: string; onDone?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const run = useAction();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await run({ action: "comment", comment: { postId, parentId, body } });
    setBusy(false);
    if (!result) return;
    setBody("");
    onDone?.();
    router.refresh();
  }

  return (
    <div className="flex items-start gap-2">
      <Textarea
        aria-label={parentId ? t("Write a reply") : t("Write a comment")}
        placeholder={parentId ? t("Write a reply…") : t("Write a comment…")}
        rows={parentId ? 2 : 3}
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="flex-1"
      />
      <Button size="sm" loading={busy} disabled={body.trim().length < 1} onClick={() => void submit()}>
        {parentId ? t("Reply") : t("Comment")}
      </Button>
    </div>
  );
}

export function ReplyToggle({ postId, parentId }: { postId: string; parentId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <MessageCircle className="size-3.5 rtl:-scale-x-100" aria-hidden />
          {t("Reply")}
        </button>
      )}
      {open && (
        <div className="mt-2">
          <CommentForm postId={postId} parentId={parentId} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
