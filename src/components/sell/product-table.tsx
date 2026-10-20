"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Package } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { Button, ButtonLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ToggleSwitch } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";

export interface ProductRow {
  id: string;
  title: string;
  slug: string;
  sku: string | null;
  status: string;
  priceCents: number;
  currency: string;
  stock: number;
  trackInventory: boolean;
  lowStockAt: number;
  soldCount: number;
  image: { url: string; alt: string | null } | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  OUT_OF_STOCK: "warning",
  DRAFT: "neutral",
};

export function ProductTable({ shopId, products, canList }: { shopId: string; products: ProductRow[]; canList: boolean }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ProductRow | null>(null);

  const statusLabel: Record<string, string> = {
    ACTIVE: t("On sale"),
    OUT_OF_STOCK: t("Out of stock"),
    DRAFT: t("Draft"),
  };

  async function setPublished(product: ProductRow, publish: boolean) {
    setBusy(product.id);
    try {
      await api.post("/api/store", { action: "update-product", productId: product.id, product: { publish } });
      router.refresh();
    } catch (err) {
      toast.error(t("Could not update the product"), err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function archive(product: ProductRow) {
    setBusy(product.id);
    try {
      await api.post("/api/store", { action: "archive-product", productId: product.id });
      toast.success(t("Product archived"));
      setArchiving(null);
      router.refresh();
    } catch (err) {
      toast.error(t("Could not archive the product"), err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  if (products.length === 0) {
    return (
      <EmptyState
        className="border-0 py-10"
        icon={<Package className="size-5" aria-hidden />}
        title={t("No products yet")}
        description={t("Add your first product, or import your catalogue from a spreadsheet.")}
        action={canList ? <ButtonLink href={`/sell/shops/${shopId}/products/new`}>{t("Add a product")}</ButtonLink> : undefined}
      />
    );
  }

  return (
    <>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs text-fg-subtle">
              <th scope="col" className="py-2 pe-3 font-medium">{t("Product")}</th>
              <th scope="col" className="py-2 pe-3 text-end font-medium">{t("Price")}</th>
              <th scope="col" className="py-2 pe-3 text-end font-medium">{t("Stock")}</th>
              <th scope="col" className="py-2 pe-3 text-end font-medium">{t("Sold")}</th>
              <th scope="col" className="py-2 pe-3 font-medium">{t("Published")}</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const low = product.trackInventory && product.stock > 0 && product.stock <= product.lowStockAt;
              const published = product.status === "ACTIVE" || product.status === "OUT_OF_STOCK";
              return (
                <tr key={product.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2.5 pe-3">
                    <div className="flex items-center gap-3">
                      <div className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-field)] bg-bg-sunken">
                        {product.image && (
                          // eslint-disable-next-line @next/next/no-img-element -- a thumbnail of the seller's own upload
                          <img src={product.image.url} alt="" className="size-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/sell/shops/${shopId}/products/${product.id}`} className="block truncate font-medium text-fg hover:underline">
                          {product.title}
                        </Link>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                          {product.sku && <span dir="ltr">{product.sku}</span>}
                          <Badge tone={STATUS_TONE[product.status] ?? "neutral"} size="sm">
                            {statusLabel[product.status] ?? product.status}
                          </Badge>
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pe-3 text-end tabular text-fg">{fmt.money(product.priceCents, product.currency)}</td>
                  <td className={`py-2.5 pe-3 text-end tabular ${low ? "font-semibold text-[var(--warning)]" : "text-fg-muted"}`}>
                    {product.trackInventory ? fmt.number(product.stock) : "∞"}
                  </td>
                  <td className="py-2.5 pe-3 text-end tabular text-fg-muted">{fmt.number(product.soldCount)}</td>
                  <td className="py-2.5 pe-3">
                    <ToggleSwitch
                      checked={published}
                      disabled={busy === product.id}
                      onChange={(next) => void setPublished(product, next)}
                      label={t("Published: {title}", { title: product.title })}
                    />
                  </td>
                  <td className="py-2.5">
                    <div className="flex justify-end gap-1">
                      <ButtonLink href={`/sell/shops/${shopId}/products/${product.id}`} variant="ghost" size="icon-sm" aria-label={t("Edit {title}", { title: product.title })}>
                        <Pencil className="size-4" aria-hidden />
                      </ButtonLink>
                      <Button variant="ghost" size="icon-sm" onClick={() => setArchiving(product)} aria-label={t("Archive {title}", { title: product.title })}>
                        <Archive className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t("Archive this product?")}
        description={t("It comes off sale and out of every basket. Past orders keep it.")}
        size="sm"
      >
        <p className="text-sm font-medium text-fg">{archiving?.title}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setArchiving(null)}>
            {t("Keep it")}
          </Button>
          <Button variant="danger" loading={busy === archiving?.id} onClick={() => archiving && void archive(archiving)}>
            {t("Archive")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
