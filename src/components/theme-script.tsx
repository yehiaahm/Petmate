/**
 * Applies the stored theme before first paint.
 *
 * This has to be a blocking inline script in <head>: doing it in an effect
 * means a dark-mode user sees a white flash on every navigation to a fresh
 * document. Reads are wrapped because storage throws in private mode and in
 * embedded webviews with site data blocked.
 */
const script = `(function(){try{var t=localStorage.getItem("pm-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;

/**
 * Production's CSP allows only nonced inline scripts, so the per-request nonce
 * from middleware has to be on this tag; without it the browser refuses the
 * script and a dark-mode user gets the white flash this exists to prevent.
 */
export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} suppressHydrationWarning />;
}
