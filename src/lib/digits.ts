/**
 * Arabic-Indic (٠١٢٣) and Persian (۰۱۲۳) digits to 0-9.
 *
 * Many Egyptians type numbers on an Arabic keyboard. JavaScript's `\d` only
 * matches 0-9, so every code, phone number and amount has to pass through
 * this before it is checked. Client-safe.
 */
export function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => String((d.charCodeAt(0) & 0x0f) % 10));
}
