"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";

interface StoredFile {
  id: string;
  name: string;
}

export function VerificationSubmit({
  type,
  subjectId,
  documentsHint,
}: {
  type: string;
  subjectId: string;
  documentsHint: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [files, setFiles] = useState<StoredFile[]>([]);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    if (files.length + list.length > 5) {
      toast.error("Up to 5 documents", "Remove one before adding more.");
      return;
    }
    setUploading(true);
    for (const file of Array.from(list)) {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("purpose", "VERIFICATION");
        const { file: stored } = await api.upload<{ file: { id: string } }>("/api/uploads", form);
        setFiles((prev) => [...prev, { id: stored.id, name: file.name }]);
      } catch (err) {
        toast.error(
          `${file.name} was not accepted`,
          err instanceof ApiError ? err.message : "Try a different file.",
        );
      }
    }
    setUploading(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Attach at least one document.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/safety", {
        action: "verify",
        verification: {
          subjectType: "USER",
          subjectId,
          type,
          documents: files.map((f) => f.id),
          notes: notes || undefined,
        },
      });
      toast.success("Submitted for review", "We will email you either way.");
      setFiles([]);
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <div>
        <p className="text-sm font-medium text-fg">Documents</p>
        <p className="mt-0.5 text-xs text-fg-muted">{documentsHint}</p>

        {files.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-[var(--radius-field)] bg-bg-sunken px-3 py-2"
              >
                <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                  className="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-fg"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-field)] border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-sunken">
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {uploading ? "Uploading…" : "Add document"}
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            onChange={(e) => void upload(e.target.files)}
            disabled={uploading || files.length >= 5}
          />
        </label>
      </div>

      <Field label="Anything we should know?" hint="Optional.">
        {({ id, invalid }) => (
          <Textarea
            id={id}
            invalid={invalid}
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>

      <Button
        type="submit"
        loading={submitting}
        loadingText="Submitting…"
        disabled={files.length === 0}
      >
        Submit for review
      </Button>
    </form>
  );
}
