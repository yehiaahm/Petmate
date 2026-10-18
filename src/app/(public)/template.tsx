/**
 * Re-mounts on every navigation (a layout does not), so each new page fades
 * up into place instead of snapping in.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
