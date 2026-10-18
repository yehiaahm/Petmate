import { describe, expect, it } from "vitest";
import { careRulesAnswer } from "@/lib/ai/care-rules";
import { features, isDisabledModulePath } from "@/lib/features";

describe("care assistant rules", () => {
  it("treats emergencies as urgent and never offers home treatment", () => {
    for (const q of [
      "my dog ate chocolate",
      "my dog can't breathe properly",
      "my cat can't pee and keeps straining in the litter box",
      "he had a seizure",
      "كلبي بيتشنج",
    ]) {
      const answer = careRulesAnswer(q);
      expect(answer.urgent, q).toBe(true);
      // The emergency-clinic link only exists while the clinics module is on;
      // either way the answer never links to a page that would 404.
      expect(answer.links.some((l) => l.href.includes("emergency=true"))).toBe(features.clinics);
      expect(answer.links.every((l) => !isDisabledModulePath(l.href.split("?")[0]!))).toBe(true);
    }
  });

  it("sends a vomiting cat that is not eating to a vet today", () => {
    const answer = careRulesAnswer("My cat is vomiting and not eating since yesterday, what should I do?");
    expect(answer.urgent).toBeFalsy();
    expect(answer.answer).toMatch(/vet today/i);
    expect(answer.answer).toMatch(/cats that stop eating/i);
  });

  it("answers everyday questions with general guidance", () => {
    expect(careRulesAnswer("Is it normal for a cat to sleep this much?").answer).toMatch(/12 to 16 hours/);
    expect(careRulesAnswer("What should I ask the vet at the next check-up?").answer).toMatch(/weight/i);
  });

  it("uses the pet's own record for vaccines", () => {
    const answer = careRulesAnswer("What vaccinations are due next?", {
      petName: "Luna",
      species: "CAT",
      overdue: ["Rabies booster"],
    });
    expect(answer.answer).toMatch(/Rabies booster/);
  });

  it("admits what it cannot answer", () => {
    expect(careRulesAnswer("who won the match yesterday").answer).toMatch(/general guidance/i);
  });
});
