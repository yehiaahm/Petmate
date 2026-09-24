"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select, ToggleSwitch } from "@/components/ui/field";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/components/i18n/i18n-provider";
import { api, ApiError } from "@/lib/api-client";
import { parseMoneyToCents } from "@/lib/money";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { LIMITS } from "@/lib/constants";

export interface ProductFormValue {
  id: string;
  title: string;
  description: string;
  categoryId: string | null;
  brand: string | null;
  sku: string | null;
  priceCents: number;
  compareAtCents: number | null;
  stock: number;
  trackInventory: boolean;
  weightGrams: number | null;
  status: string;
  images: { url: string; alt: string | null }[];
}

interface CategoryOption {
  id: string;
  name: string;
  parentId: string | null;
}

const toMajor = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

export function ProductForm({
  shopId,
  categories,
  product,
}: {
  shopId: string;
  categories: CategoryOption[];
  /** Present when editing. */
  product?: ProductFormValue;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState({
    title: product?.title ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? "",
    brand: product?.brand ?? "",
    sku: product?.sku ?? "",
    price: toMajor(product?.priceCents),
    compareAt: toMajor(product?.compareAtCents),
    stock: product ? String(product.stock) : "0",
    trackInventory: product?.trackInventory ?? true,
    weight: product?.weightGrams != null ? String(product.weightGrams) : "",
    publish: product ? product.status === "ACTIVE" || product.status === "OUT_OF_STOCK" : true,
  });
  const [images, setImages] = useState(product?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const fieldError = (name: string) => (error instanceof ApiError ? error.fieldError(name) : undefined);

  // Parents first, each followed by its children, so the select reads as a tree.
  const parents = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const room = LIMITS.imagesPerProduct - images.length;
    if (room <= 0) {
      toast.error(t("Up to {count} photos", { count: LIMITS.imagesPerProduct }), t("Remove one before adding more."));
      return;
    }
    setUploading(true);
    for (const file of Array.from(files).slice(0, room)) {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "PRODUCT_IMAGE");
      try {
        const { file: stored } = await api.upload<{ file: { url: string } }>("/api/uploads", form);
        setImages((list) => [...list, { url: stored.url, alt: null }]);
      } catch (err) {
        toast.error(t("That photo was not accepted"), err instanceof ApiError ? err.message : t("Please try a different image."));
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const priceCents = parseMoneyToCents(values.price);
    const compareAtCents = values.compareAt ? parseMoneyToCents(values.compareAt) : undefined;
    const stock = Number(values.stock || 0);
    const weightGrams = values.weight ? Number(values.weight) : undefined;
    if (priceCents === null || compareAtCents === null) {
      setError(new Error(t("Enter prices as numbers, like 250 or 249.50.")));
      return;
    }
    if (!Number.isInteger(stock) || stock < 0 || (weightGrams !== undefined && !Number.isInteger(weightGrams))) {
      setError(new Error(t("Stock and weight must be whole numbers.")));
      return;
    }

    const payload = {
      title: values.title,
      description: values.description,
      categoryId: values.categoryId || undefined,
      brand: values.brand || undefined,
      sku: values.sku || undefined,
      priceCents,
      compareAtCents,
      stock,
      trackInventory: values.trackInventory,
      weightGrams,
      images: images.map((img) => ({ url: img.url, alt: img.alt || undefined })),
      publish: values.publish,
    };

    setSubmitting(true);
    try {
      if (product) {
        await api.post("/api/store", { action: "update-product", productId: product.id, product: payload });
        toast.success(t("Product saved"));
      } else {
        await api.post("/api/store", { action: "create-product", shopId, product: payload });
        toast.success(t("Product added"));
      }
      router.push(`/sell/shops/${shopId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(t("Could not save the product.")));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && !(error instanceof ApiError && error.isValidation) && <Alert tone="danger">{error.message}</Alert>}

      <Card>
        <CardHeader title={t("Product")} />
        <div className="space-y-5 p-5">
          <Field label={t("Title")} required error={fieldError("title")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} required maxLength={LIMITS.titleMax} value={values.title} onChange={(e) => set("title", e.target.value)} />
            )}
          </Field>
          <Field
            label={t("Description")}
            required
            hint={t("What it is, who it is for, and anything a buyer should check before ordering.")}
            error={fieldError("description")}
          >
            {({ id, invalid }) => (
              <Textarea id={id} invalid={invalid} rows={6} maxLength={LIMITS.descriptionMax} value={values.description} onChange={(e) => set("description", e.target.value)} />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label={t("Category")} error={fieldError("categoryId")}>
              {({ id }) => (
                <Select id={id} value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">{t("No category")}</option>
                  {parents.map((parent) => (
                    <optgroup key={parent.id} label={t(parent.name)}>
                      <option value={parent.id}>{t(parent.name)}</option>
                      {childrenOf(parent.id).map((child) => (
                        <option key={child.id} value={child.id}>
                          {t(child.name)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("Brand")} error={fieldError("brand")}>
              {({ id, invalid }) => (
                <Input id={id} invalid={invalid} maxLength={80} value={values.brand} onChange={(e) => set("brand", e.target.value)} />
              )}
            </Field>
            <Field label={t("SKU")} hint={t("Your own stock code. Bulk updates match on it.")} error={fieldError("sku")}>
              {({ id, invalid }) => (
                <Input id={id} invalid={invalid} dir="ltr" className="rtl:text-end" maxLength={60} value={values.sku} onChange={(e) => set("sku", e.target.value)} />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("Photos")} description={t("The first photo is the one buyers see in search.")} />
        <div className="p-5">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {images.map((img, index) => (
              <li key={img.url} className="relative aspect-square overflow-hidden rounded-[var(--radius-field)] border border-[var(--border)] bg-bg-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of an upload */}
                <img src={img.url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((list) => list.filter((_, i) => i !== index))}
                  className="absolute end-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-[var(--overlay)] text-white"
                  aria-label={t("Remove photo {n}", { n: index + 1 })}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
            {images.length < LIMITS.imagesPerProduct && (
              <li>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-field)] border border-dashed border-[var(--border-strong)] text-sm text-fg-muted transition-colors hover:bg-bg-sunken disabled:opacity-60"
                >
                  <ImagePlus className="size-5" aria-hidden />
                  {uploading ? t("Uploading…") : t("Add photos")}
                </button>
              </li>
            )}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => void addImages(e.target.files)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title={t("Price and stock")} />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label={t("Price ({currency})", { currency: PLATFORM_CURRENCY })} required error={fieldError("priceCents")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} required inputMode="decimal" dir="ltr" className="rtl:text-end" value={values.price} onChange={(e) => set("price", e.target.value)} />
            )}
          </Field>
          <Field
            label={t("Compare-at price ({currency})", { currency: PLATFORM_CURRENCY })}
            hint={t("The old price, shown struck through. Must be higher than the price.")}
            error={fieldError("compareAtCents")}
          >
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} inputMode="decimal" dir="ltr" className="rtl:text-end" value={values.compareAt} onChange={(e) => set("compareAt", e.target.value)} />
            )}
          </Field>
          <Field label={t("In stock")} error={fieldError("stock")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} inputMode="numeric" dir="ltr" className="rtl:text-end" value={values.stock} onChange={(e) => set("stock", e.target.value)} disabled={!values.trackInventory} />
            )}
          </Field>
          <Field label={t("Weight (grams)")} hint={t("Used to quote courier delivery.")} error={fieldError("weightGrams")}>
            {({ id, invalid }) => (
              <Input id={id} invalid={invalid} inputMode="numeric" dir="ltr" className="rtl:text-end" value={values.weight} onChange={(e) => set("weight", e.target.value)} />
            )}
          </Field>
          <div className="flex items-center justify-between gap-4 sm:col-span-2">
            <div>
              <p className="text-sm font-medium text-fg">{t("Track stock")}</p>
              <p className="text-xs text-fg-muted">{t("Stops selling when it reaches zero. Turn off for made-to-order items.")}</p>
            </div>
            <ToggleSwitch checked={values.trackInventory} onChange={(v) => set("trackInventory", v)} label={t("Track stock")} />
          </div>
        </div>
      </Card>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-fg">{t("Published")}</p>
          <p className="text-xs text-fg-muted">{t("Unpublished products are saved as drafts that only you can see.")}</p>
        </div>
        <ToggleSwitch checked={values.publish} onChange={(v) => set("publish", v)} label={t("Published")} />
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          {t("Cancel")}
        </Button>
        <Button type="submit" loading={submitting} loadingText={t("Saving…")} disabled={uploading}>
          {product ? t("Save changes") : t("Add product")}
        </Button>
      </div>
    </form>
  );
}
