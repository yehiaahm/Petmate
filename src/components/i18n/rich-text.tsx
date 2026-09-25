import { Fragment, type ReactNode } from "react";

/**
 * Places elements inside a translated sentence.
 *
 * `t()` only interpolates text, but some sentences carry a styled value or a
 * link in the middle ("Your reference is <b>{reference}</b>"). Translating the
 * pieces separately fixes the English word order onto every language, so the
 * whole sentence is translated with its placeholders left in, and this swaps
 * each remaining `{name}` for the matching node.
 */
export function RichText({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const parts = text.split(/\{(\w+)\}/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <Fragment key={i}>{part in values ? values[part] : `{${part}}`}</Fragment> : part,
      )}
    </>
  );
}
