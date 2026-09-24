import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface LineageNode {
  id: string;
  name: string;
  passportNo: string;
  sex: string;
  verificationLevel: string;
  dam: LineageNode | null;
  sire: LineageNode | null;
}

/**
 * Pedigree tree.
 *
 * Recorded lineage is the difference between a claimed pedigree and a
 * checkable one, so each ancestor links to its own passport. Rendered as a
 * nested list rather than a canvas so it is readable by a screen reader and
 * degrades to a plain outline on a narrow screen.
 */
export function LineageTree({ node }: { node: LineageNode | null }) {
  if (!node) return null;

  return (
    <div className="overflow-x-auto">
      <ul className="min-w-fit">
        <LineageBranch node={node} depth={0} relation="Subject" />
      </ul>
    </div>
  );
}

function LineageBranch({
  node,
  depth,
  relation,
}: {
  node: LineageNode;
  depth: number;
  relation: string;
}) {
  const verified =
    node.verificationLevel === "CLINIC_VERIFIED" || node.verificationLevel === "DOCUMENTED";

  return (
    <li className={cn(depth > 0 && "border-s border-[var(--border)] ps-4")}>
      <div className="flex items-center gap-2.5 py-1.5">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            node.sex === "FEMALE"
              ? "bg-accent-soft text-accent-soft-fg"
              : "bg-brand-soft text-brand-soft-fg",
          )}
          aria-hidden
        >
          {node.sex === "FEMALE" ? "♀" : node.sex === "MALE" ? "♂" : "?"}
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            {depth === 0 ? (
              <span className="text-sm font-semibold text-fg">{node.name}</span>
            ) : (
              <Link
                href={`/p/${node.id}`}
                className="text-sm font-semibold text-fg hover:underline"
              >
                {node.name}
              </Link>
            )}
            {verified && (
              <BadgeCheck className="size-3.5 shrink-0 text-[var(--success)]" aria-label="Verified" />
            )}
          </span>
          <span className="block text-xs text-fg-subtle">
            {relation} · <span className="font-mono">{node.passportNo}</span>
          </span>
        </span>
      </div>

      {(node.dam || node.sire) && (
        <ul>
          {node.dam && <LineageBranch node={node.dam} depth={depth + 1} relation="Mother" />}
          {node.sire && <LineageBranch node={node.sire} depth={depth + 1} relation="Father" />}
        </ul>
      )}
    </li>
  );
}
