import { describe, it, expect, beforeEach } from "vitest";
import { db, makeUser, makePet, makeListing, resetDatabase } from "./helpers";
import {
  normalizeSearchText,
  parseSearchTerms,
  buildSearchText,
  cityVariants,
  speciesSearchWords,
} from "@/lib/search/text";
import { slugify } from "@/lib/utils";
import { deterministicSearchParse } from "@/lib/ai/features";
import { searchListings } from "@/lib/services/search.service";
import { priceCurrencySchema } from "@/lib/validation/common";
import { PLATFORM_CURRENCY } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { PLANS } from "../prisma/seed-data";

describe("Arabic search text", () => {
  it("keeps Arabic letters, which the old normaliser deleted outright", () => {
    expect(normalizeSearchText("جرو جولدن للبيع")).toBe("جرو جولدن للبيع");
    expect(buildSearchText("قطة شيرازي")).not.toBe("");
  });

  it("folds the spellings people use interchangeably", () => {
    // Vowel marks, hamza forms, alef maksura, teh marbuta, tatweel.
    expect(normalizeSearchText("قِطّة")).toBe(normalizeSearchText("قطه"));
    expect(normalizeSearchText("أرنب")).toBe(normalizeSearchText("ارنب"));
    expect(normalizeSearchText("إنجليزي")).toBe(normalizeSearchText("انجليزي"));
    expect(normalizeSearchText("مستشفى")).toBe(normalizeSearchText("مستشفي"));
    expect(normalizeSearchText("كـــلب")).toBe("كلب");
    expect(normalizeSearchText("٥٠٠٠")).toBe("5000");
  });

  it("drops the joined article from query terms so الكلب finds كلب", () => {
    expect(parseSearchTerms("الكلب الذهبي")).toEqual(["كلب", "ذهبي"]);
    expect(parseSearchTerms("قطط في القاهرة")).toEqual(["قطط", "قاهره"]);
  });

  it("still folds Latin accents exactly as before", () => {
    expect(normalizeSearchText("Münchener Schäferhund")).toBe("munchener schaferhund");
  });

  it("indexes species in both languages", () => {
    expect(speciesSearchWords("DOG")).toContain("كلب");
    expect(speciesSearchWords("CAT")).toContain("cat");
  });
});

describe("slugs", () => {
  it("romanises Arabic titles instead of collapsing them to 'item'", () => {
    expect(slugify("جرو جولدن ريتريفر للبيع")).toBe("gru-guldn-ritrifr-llbia");
    expect(slugify("قطة شيرازي")).toBe("qta-shirazi");
    expect(slugify("ولد لطيف")).toBe("wld-ltif");
    expect(slugify("Bella the Lab")).toBe("bella-the-lab");
    expect(slugify("!!!")).toBe("item");
  });
});

describe("Arabic plain-language search", () => {
  it("understands Egyptian Arabic searches", () => {
    const parsed = deterministicSearchParse("عايز جرو جولدن في القاهرة تحت ٥٠٠٠");
    expect(parsed.species).toEqual(["DOG"]);
    expect(parsed.city).toBe("Cairo");
    expect(parsed.maxPriceCents).toBe(500_000);
    expect(parsed.maxAgeMonths).toBe(12);
    expect(parsed.query).toBe("جولدن");
    expect(parsed.interpretation).toContain("القاهرة");
  });

  it("reads colloquial words for free, stud and adoption", () => {
    const free = deterministicSearchParse("قطة للتبني ببلاش");
    expect(free).toMatchObject({ species: ["CAT"], intent: "ADOPTION", maxPriceCents: 0 });

    const stud = deterministicSearchParse("طلوقة هاسكي ذكر متطعم");
    expect(stud).toMatchObject({ intent: "BREEDING", sex: "MALE", vaccinatedOnly: true, query: "هاسكي" });
  });

  it("treats a two-word city as one place", () => {
    const parsed = deterministicSearchParse("كلب في الشيخ زايد");
    expect(parsed.city).toBe("Sheikh Zayed");
    expect(parsed.query).toBeUndefined();
  });

  it("no longer requires the listing text to contain the city it filtered on", () => {
    const parsed = deterministicSearchParse("vaccinated labrador under 1200 near cairo");
    expect(parsed.city).toBe("cairo");
    expect(parsed.query).toBe("labrador");
  });
});

describe("city matching", () => {
  it("covers case and both languages", () => {
    expect(cityVariants("cairo")).toEqual(expect.arrayContaining(["cairo", "Cairo", "القاهرة"]));
    expect(cityVariants("الاسكندريه")).toEqual(expect.arrayContaining(["Alexandria", "الإسكندرية"]));
    expect(cityVariants("Paris")).toEqual(["Paris", "paris"]);
  });

  describe("against the database", () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it("finds listings stored as 'Cairo' or 'القاهرة' from a lowercase or Arabic filter", async () => {
      const seller = await makeUser();
      const english = await makeListing(seller.id, (await makePet(seller.id)).id);
      const arabic = await makeListing(seller.id, (await makePet(seller.id)).id);
      await db.listing.update({ where: { id: arabic.id }, data: { city: "القاهرة" } });

      for (const city of ["cairo", "Cairo", "القاهره"]) {
        const ids = (await searchListings({ city })).items.map((l) => l.id).sort();
        expect(ids, city).toEqual([english.id, arabic.id].sort());
      }
    });

    it("finds an Arabic-titled listing by an Arabic query", async () => {
      const seller = await makeUser();
      const listing = await makeListing(seller.id, (await makePet(seller.id)).id);
      await db.listing.update({
        where: { id: listing.id },
        data: { title: "جرو جولدن ريتريفر", searchText: buildSearchText("جرو جولدن ريتريفر", speciesSearchWords("DOG")) },
      });

      const found = await searchListings({ query: "الجرو" });
      expect(found.items.map((l) => l.id)).toContain(listing.id);
    });
  });
});

describe("platform currency", () => {
  it("is Egyptian pounds by default", () => {
    expect(PLATFORM_CURRENCY).toBe("EGP");
    expect(formatMoney(150_000)).toBe("EGP 1,500");
  });

  it("accepts prices only in the platform currency, which it also defaults to", () => {
    expect(priceCurrencySchema.parse(undefined)).toBe("EGP");
    expect(priceCurrencySchema.parse("EGP")).toBe("EGP");
    const usd = priceCurrencySchema.safeParse("USD");
    expect(usd.success).toBe(false);
    expect(usd.error?.issues[0]?.message).toBe("Prices on PetMate are in EGP.");
  });

  it("prices every paid plan in pounds, with a real yearly discount", () => {
    for (const plan of PLANS.filter((p) => p.priceMonthlyCents > 0)) {
      expect(plan.priceMonthlyCents % 100, plan.code).toBe(0);
      expect(plan.priceYearlyCents, plan.code).toBeLessThan(plan.priceMonthlyCents * 12);
    }
  });
});
