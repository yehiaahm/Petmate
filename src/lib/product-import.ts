/**
 * The product import format, shared by the service that reads it and the
 * screen that explains it. Client-safe.
 *
 * Prices are in pounds (major units) because that is what a shop keeps in its
 * spreadsheet; the service converts to piastres.
 */
export const PRODUCT_IMPORT_COLUMNS = [
  "sku",
  "title",
  "description",
  "price",
  "compare_at_price",
  "stock",
  "brand",
  "category",
  "weight_grams",
  "publish",
] as const;

export const MAX_IMPORT_ROWS = 500;

export const PRODUCT_IMPORT_TEMPLATE = [
  PRODUCT_IMPORT_COLUMNS.join(","),
  'NF-DRY-12,"Grain-free adult dog food, 12kg","Single-protein salmon recipe with no wheat, corn or soy.",2850,3200,40,Northfield,dry-food,12000,yes',
  "VL-FLEA-6,Spot-on flea and tick treatment (6 pack),Six monthly pipettes for dogs 10-25kg. Read the weight band carefully.,950,,120,Vetline,flea-tick,,yes",
].join("\n");
