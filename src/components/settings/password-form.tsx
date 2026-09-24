"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { PasswordStrength } from "@/components/auth/password-strength";

export function PasswordForm() {
  const router = useRouter();
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mismatch = confirm.length > 0 && confirm !== newPassword;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/account", {
        action: "change-password",
        currentPassword,
        newPassword,
      });
      toast.success("Password changed", "Other devices have been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err);
      else toast.error("Could not change password", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-5" noValidate>
      {error && !error.isValidation && <Alert tone="danger">{error.message}</Alert>}

      <Field label="Current password" required error={error?.fieldError("currentPassword")}>
        {({ id, invalid }) => (
          <Input
            id={id}
            invalid={invalid}
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        )}
      </Field>

      <Field label="New password" required error={error?.fieldError("newPassword")}>
        {({ id, invalid }) => (
          <>
            <Input
              id={id}
              invalid={invalid}
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {newPassword && <PasswordStrength password={newPassword} className="mt-2" />}
          </>
        )}
      </Field>

      <Field
        label="Confirm new password"
        required
        error={mismatch ? "The two passwords do not match." : undefined}
      >
        {({ id, invalid }) => (
          <Input
            id={id}
            invalid={invalid}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
      </Field>

      <Button
        type="submit"
        loading={saving}
        loadingText="Changing…"
        disabled={!currentPassword || !newPassword || mismatch}
      >
        Change password
      </Button>
    </form>
  );
}
