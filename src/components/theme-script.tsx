import { headers } from "next/headers";

/**
 * Applies the stored theme before first paint.
 *
 * This has to be a blocking inline script in <head>: doing it in an effect
 * means a dark-mode user sees a white flash on every navigation to a fresh
 * document. Reads are wrapped because storage throws in private mode and in
 * embedded webviews with site data blocked.
 *
 * Next stamps its own bootstrap scripts with the CSP nonce, but not one we
 * write by hand, so this reads the nonce the middleware set and applies it.
 * Without that the production CSP blocks exactly this script, and the flash it
 * exists to prevent comes back.
 */
const script = `(function(){try{var t=localStorage.getItem("pm-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;

export async function ThemeScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} suppressHydrationWarning />
  );
}
