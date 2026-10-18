import { describe, expect, it } from "vitest";
import { interpretQuery } from "@/lib/search/intent";
import { normalizeSearchText, parseSearchTerms } from "@/lib/search/text";

describe("search query interpretation", () => {
  it("reads the homepage example searches", () => {
    expect(interpretQuery("vaccinated labrador under 1200")).toMatchObject({
      residual: "labrador",
      maxPriceCents: 120_000,
      vaccinatedOnly: true,
    });

    expect(interpretQuery("kitten for adoption")).toMatchObject({
      species: "CAT",
      intent: "ADOPTION",
      residual: "",
    });

    const calm = interpretQuery("calm small dog near me");
    expect(calm.species).toBe("DOG");
    expect(calm.nearMe).toBe(true);
    expect(calm.residual).toBe("");
  });

  it("keeps unknown words as keywords", () => {
    expect(interpretQuery("golden puppy cairo")).toMatchObject({ species: "DOG", residual: "golden cairo" });
    expect(interpretQuery("labrador")).toMatchObject({ residual: "labrador" });
  });

  it("understands Arabic", () => {
    expect(interpretQuery("كلب").species).toBe("DOG");
    expect(interpretQuery("قطة للتبني")).toMatchObject({ species: "CAT", intent: "ADOPTION" });
    // Hamza and ta marbuta variants are folded together.
    expect(interpretQuery("أرنب").species).toBe("RABBIT");
  });

  it("no longer turns an Arabic query into 'match everything'", () => {
    expect(normalizeSearchText("كلب")).not.toBe("");
    expect(parseSearchTerms("بيجل")).toEqual(["بيجل"]);
  });
});
