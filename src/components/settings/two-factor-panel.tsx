"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, KeyRound, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { toWesternDigits } from "@/lib/digits";

interface Setup {
  secret: string;
  qrSvg: string;
}

/**
 * Turning two-step sign-in on and off, and replacing backup codes.
 *
 * Backup codes are shown exactly once, straight after they are made; the
 * server keeps only their hashes, so there is no "show my codes" later.
 */
export function TwoFactorPanel({ enabled, backupCodesLeft }: { enabled: boolean; backupCodesLeft: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [modal, setModal] = useState<null | "disable" | "regenerate">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call<T>(body: Record<string, unknown>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await api.post<T>("/api/account", body);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Please try again."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    const result = await call<Setup>({ action: "2fa-begin" });
    if (result) setSetup(result);
  }

  async function confirm() {
    const result = await call<{ backupCodes: string[] }>({ action: "2fa-confirm", code });
    if (!result) return;
    setSetup(null);
    setCode("");
    setCodes(result.backupCodes);
    toast.success(t("Two-step sign-in is on"));
  }

  async function disable() {
    const result = await call({ action: "2fa-disable", password, code });
    if (!result) return;
    setModal(null);
    setPassword("");
    setCode("");
    toast.success(t("Two-step sign-in is off"));
    router.refresh();
  }

  async function regenerate() {
    const result = await call<{ backupCodes: string[] }>({ action: "2fa-backup-codes", code });
    if (!result) return;
    setModal(null);
    setCode("");
    setCodes(result.backupCodes);
  }

  function download() {
    if (!codes) return;
    const blob = new Blob([`PetMate backup codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "petmate-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (codes) {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title={t("Save your backup codes now")}>
          {t("Each code signs you in once if you lose your phone. This is the only time they are shown.")}
        </Alert>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5" dir="ltr">
          {codes.map((c) => (
            <li key={c} className="rounded-[var(--radius-field)] bg-bg-sunken px-3 py-2 text-center tabular text-fg">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success(t("Copied")))}
          >
            <Copy className="size-4" aria-hidden />
            {t("Copy")}
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="size-4" aria-hidden />
            {t("Download")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setCodes(null);
              router.refresh();
            }}
          >
            {t("I have saved them")}
          </Button>
        </div>
      </div>
    );
  }

  if (setup) {
    return (
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <ol className="list-decimal space-y-1 ps-5 text-sm text-fg-muted">
          <li>{t("Open an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.")}</li>
          <li>{t("Scan this code, or type the key in by hand.")}</li>
          <li>{t("Enter the six-digit code the app shows.")}</li>
        </ol>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          {/* Generated on our server from our own data; it contains no markup from anyone else. */}
          <div
            className="size-44 shrink-0 rounded-lg bg-white p-2"
            role="img"
            aria-label={t("QR code for your authenticator app")}
            dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          />
          <div>
            <p className="text-xs text-fg-subtle">{t("Setup key")}</p>
            <p className="mt-1 break-all font-mono text-sm text-fg" dir="ltr">
              {setup.secret}
            </p>
          </div>
        </div>
        <Field label={t("Code from the app")}>
          {({ id }) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              dir="ltr"
              value={code}
              onChange={(e) => setCode(toWesternDigits(e.target.value).replace(/[^\d ]/g, ""))}
              className="max-w-40 tracking-widest"
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setSetup(null)}>
            {t("Cancel")}
          </Button>
          <Button loading={busy} disabled={code.replace(/\s/g, "").length !== 6} onClick={() => void confirm()}>
            {t("Turn on")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && !modal && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        {enabled ? (
          <Badge tone="success">
            <ShieldCheck className="size-3.5" aria-hidden /> {t("On")}
          </Badge>
        ) : (
          <Badge tone="neutral">{t("Off")}</Badge>
        )}
        {enabled && (
          <span className="text-sm text-fg-muted">
            {t.plural(backupCodesLeft, { one: "{count} backup code left", other: "{count} backup codes left" })}
          </span>
        )}
      </div>

      {enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setModal("regenerate")}>
            <KeyRound className="size-4" aria-hidden />
            {t("New backup codes")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setModal("disable")}>
            {t("Turn off")}
          </Button>
        </div>
      ) : (
        <Button onClick={() => void begin()} loading={busy}>
          <ShieldCheck className="size-4" aria-hidden />
          {t("Set up two-step sign-in")}
        </Button>
      )}

      <Modal
        open={modal !== null}
        onClose={() => {
          setModal(null);
          setError(null);
        }}
        title={modal === "disable" ? t("Turn off two-step sign-in?") : t("Replace your backup codes?")}
        description={
          modal === "disable"
            ? t("Your account will be protected by your password alone.")
            : t("Your old codes stop working as soon as the new ones are made.")
        }
        size="sm"
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {modal === "disable" && (
            <Field label={t("Password")}>
              {({ id }) => (
                <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
          )}
          <Field label={t("Code from the app, or a backup code")}>
            {({ id }) => <Input id={id} autoComplete="one-time-code" dir="ltr" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant={modal === "disable" ? "danger" : "primary"}
              loading={busy}
              disabled={code.trim().length < 6 || (modal === "disable" && !password)}
              onClick={() => void (modal === "disable" ? disable() : regenerate())}
            >
              {modal === "disable" ? t("Turn off") : t("Make new codes")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
