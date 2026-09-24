/**
 * Sends the browser to a payment page. A hosted checkout (Paymob) is on
 * another origin, which the app router cannot navigate to client-side, so an
 * absolute URL is a full page load; a path stays inside the app.
 *
 * Client-safe. Returns true when it navigated away from the app.
 */
export function goToPayment(url: string, push?: (path: string) => void): boolean {
  if (/^https?:\/\//i.test(url)) {
    window.location.assign(url);
    return true;
  }
  if (push) push(url);
  else window.location.assign(url);
  return false;
}
