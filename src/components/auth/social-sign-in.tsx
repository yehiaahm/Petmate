import type { OAuthProvider } from "@/lib/auth/oauth";

/**
 * "Continue with Google / Facebook". Plain links to our start endpoint, so
 * they work before JavaScript loads; rendered only for configured providers.
 */
export function SocialSignIn({
  providers,
  next,
  labels,
}: {
  providers: OAuthProvider[];
  next: string;
  labels: { google: string; facebook: string; or: string };
}) {
  if (providers.length === 0) return null;
  const query = next && next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <a
          key={provider}
          href={`/api/auth/oauth/${provider}/start${query}`}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-[var(--radius-field)] border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-sm font-semibold text-fg transition-colors hover:bg-bg-sunken"
        >
          {provider === "google" ? <GoogleMark /> : <FacebookMark />}
          {labels[provider]}
        </a>
      ))}
      <div className="flex items-center gap-3 text-xs text-fg-subtle" aria-hidden>
        <span className="h-px flex-1 bg-[var(--border)]" />
        {labels.or}
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z"
      />
    </svg>
  );
}
