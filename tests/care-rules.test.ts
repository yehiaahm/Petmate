import { describe, expect, it } from "vitest";
import { careRulesAnswer } from "@/lib/ai/care-rules";

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
      expect(answer.links.some((l) => l.href.includes("emergency=true"))).toBe(true);
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
