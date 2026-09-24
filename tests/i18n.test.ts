import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  localizedPath,
  negotiateLocale,
  splitLocalePath,
  localeDirection,
} from "@/lib/i18n/config";
import { createTranslator, interpolate, translateMessage, type Messages } from "@/lib/i18n/translate";
import { createFormatter } from "@/lib/i18n/format";
import { ar } from "@/lib/i18n/ar";
import { formatMoney } from "@/lib/money";

describe("locale resolution", () => {
  it("honours Accept-Language quality values and ignores what we do not ship", () => {
    expect(negotiateLocale("ar-EG,ar;q=0.9,en;q=0.8")).toBe("ar");
    expect(negotiateLocale("en-US,en;q=0.9,ar;q=0.5")).toBe("en");
    expect(negotiateLocale("fr-FR,ar;q=0.3")).toBe("ar");
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBeNull();
    expect(negotiateLocale("ar;q=0")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
  });

  it("round-trips locale prefixes without touching lookalike paths", () => {
    expect(splitLocalePath("/ar/pets")).toEqual({ locale: "ar", path: "/pets" });
    expect(splitLocalePath("/en")).toEqual({ locale: "en", path: "/" });
    expect(splitLocalePath("/arabian-horses")).toEqual({ locale: null, path: "/arabian-horses" });
    expect(splitLocalePath("/pets")).toEqual({ locale: null, path: "/pets" });
    expect(localizedPath("ar", "/")).toBe("/ar");
    expect(localizedPath("en", "/pets?intent=ADOPTION")).toBe("/en/pets?intent=ADOPTION");
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
  });
});

describe("translation", () => {
  const messages: Messages = {
    "Sign in": "تسجيل الدخول",
    "Hello {name}": "مرحبًا {name}",
    "{count} products": { one: "منتج واحد", two: "منتجان", few: "{count} منتجات", other: "{count} منتج" },
    "Use at least {n} characters.": "استخدم {n} أحرف على الأقل.",
    "{what} could not be found.": "تعذّر العثور على {what}.",
    "That clinic": "هذه العيادة",
  };

  it("uses the English sentence as the key and falls back to it", () => {
    const en = createTranslator("en", messages);
    const arT = createTranslator("ar", messages);
    expect(en("Sign in")).toBe("Sign in");
    expect(arT("Sign in")).toBe("تسجيل الدخول");
    expect(arT("Not in the dictionary")).toBe("Not in the dictionary");
    expect(arT("Hello {name}", { name: "Mona" })).toBe("مرحبًا Mona");
  });

  it("picks Arabic plural categories, which English does not have", () => {
    const arT = createTranslator("ar", messages);
    const en = createTranslator("en", messages);
    const forms = { one: "{count} product", other: "{count} products" };
    expect(en.plural(1, forms)).toBe("1 product");
    expect(en.plural(3, forms)).toBe("3 products");
    expect(arT.plural(1, forms)).toBe("منتج واحد");
    expect(arT.plural(2, forms)).toBe("منتجان");
    expect(arT.plural(5, forms)).toBe("5 منتجات");
    expect(arT.plural(40, forms)).toBe("40 منتج");
  });

  it("translates sentences a service composed before the locale was known", () => {
    expect(translateMessage("ar", messages, "Use at least 10 characters.")).toBe("استخدم 10 أحرف على الأقل.");
    // The captured phrase is translated too, so no English is left inside.
    expect(translateMessage("ar", messages, "That clinic could not be found.")).toBe("تعذّر العثور على هذه العيادة.");
    expect(translateMessage("ar", messages, "Something new went wrong.")).toBe("Something new went wrong.");
    expect(translateMessage("en", messages, "Use at least 10 characters.")).toBe("Use at least 10 characters.");
  });

  it("leaves unknown placeholders visible rather than printing undefined", () => {
    expect(interpolate("Hi {name}, {missing}", { name: "Ali" })).toBe("Hi Ali, {missing}");
  });
});

describe("formatting", () => {
  it("renders times in the platform time zone, not the server's", () => {
    const fmt = createFormatter("en", {}, "Africa/Cairo");
    // 07:00 UTC is 10:00 in Cairo in September (UTC+3, summer time).
    const moment = new Date("2026-09-24T07:00:00Z");
    expect(fmt.time(moment)).toBe("10:00 AM");
    expect(fmt.date(moment)).toBe("Sep 24, 2026");
  });

  it("writes Arabic dates and money with Latin digits", () => {
    const fmt = createFormatter("ar", ar, "Africa/Cairo");
    expect(fmt.date(new Date("2026-09-24T07:00:00Z"))).toMatch(/24/);
    expect(fmt.date(new Date("2026-09-24T07:00:00Z"))).not.toMatch(/[٠-٩]/);
    const price = fmt.money(120_050, "EGP");
    expect(price).toContain("1,200.50");
    expect(price).toContain("ج.م");
    expect(fmt.money(0, "EGP", { showFree: true })).toBe("مجاناً");
  });

  it("keeps the English money format exactly as it was", () => {
    expect(formatMoney(120_000, "USD")).toBe("$1,200");
    expect(formatMoney(120_050, "USD", { locale: "en" })).toBe("$1,200.50");
  });

  it("says a pet's age in Arabic with the right plural", () => {
    const fmt = createFormatter("ar", ar);
    const monthsAgo = (n: number) => {
      const d = new Date();
      d.setMonth(d.getMonth() - n);
      d.setDate(d.getDate() - 1);
      return d;
    };
    expect(fmt.age(monthsAgo(1))).toBe("شهر واحد");
    expect(fmt.age(monthsAgo(24))).toBe("سنتان");
    expect(fmt.age(null)).toBe("العمر غير معروف");
  });
});

// ---------------------------------------------------------------------------
// Dictionary coverage
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every string literal passed straight to `t(...)` or used as a plural `other`. */
function translationKeys(source: string): string[] {
  const keys: string[] = [];
  const literal = String.raw`"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\`((?:[^\`\\$]|\\.)*)\``;
  const call = new RegExp(String.raw`(?<![\w.])t\(\s*(?:${literal})`, "g");
  const plural = new RegExp(String.raw`other:\s*(?:${literal})`, "g");
  const unescape = (s: string) => s.replace(/\\(["'\`\\])/g, "$1").replace(/\\n/g, "\n");
  for (const m of source.matchAll(call)) keys.push(unescape(m[1] ?? m[2] ?? m[3] ?? ""));
  if (source.includes(".plural(")) {
    for (const m of source.matchAll(plural)) keys.push(unescape(m[1] ?? m[2] ?? m[3] ?? ""));
  }
  return keys;
}

describe("Arabic dictionary", () => {
  it("has an entry for every sentence the interface translates", () => {
    const missing = new Map<string, string>();
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      if (file.includes(`${path.sep}i18n${path.sep}ar${path.sep}`)) continue;
      // Comments may quote examples like t("Sign in"); only code counts.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const key of translationKeys(code)) {
        if (!(key in ar) && !missing.has(key)) missing.set(key, path.relative(process.cwd(), file));
      }
    }
    const report = [...missing].map(([key, file]) => `  ${file}: ${JSON.stringify(key)}`).join("\n");
    expect(missing.size, `Untranslated sentences:\n${report}`).toBe(0);
  });

  it("translates every message a service can send back", () => {
    // Messages given to the AppError helpers, with each interpolation replaced
    // by a sample value, must come back changed from the Arabic translator.
    const thrown = new RegExp(
      String.raw`\b(?:badRequest|forbidden|conflict|unprocessable|unauthenticated|paymentFailed|upgradeRequired|dependencyFailed)\(\s*(\`(?:[^\`\\]|\\.)*\`|"(?:[^"\\]|\\.)*")|new AppError\(\s*"[A-Z_]+",\s*(\`(?:[^\`\\]|\\.)*\`|"(?:[^"\\]|\\.)*")`,
      "g",
    );
    const subject = /\bnotFound\(\s*"([^"]+)"\s*\)/g;
    const missing: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(thrown)) {
        const literal = (m[1] ?? m[2])!;
        let n = 0;
        const sample = literal
          .slice(1, -1)
          .replace(/\$\{[^}]*\}/g, () => `X${++n}`)
          .replace(/\\(["'\`\\])/g, "$1");
        if (translateMessage("ar", ar, sample) === sample) missing.push(`${path.relative(process.cwd(), file)}: ${sample}`);
      }
      for (const m of code.matchAll(subject)) {
        if (!(m[1]! in ar)) missing.push(`${path.relative(process.cwd(), file)}: notFound subject ${m[1]}`);
      }
    }
    expect([...new Set(missing)], [...new Set(missing)].join("\n")).toEqual([]);
  });

  it("keeps every placeholder in the Arabic sentence", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const broken: string[] = [];
    for (const [key, value] of Object.entries(ar)) {
      const expected = names(key).filter((n) => n !== "count");
      const forms = typeof value === "string" ? [value] : Object.values(value);
      for (const form of forms) {
        const got = names(form as string);
        for (const n of expected) if (!got.includes(n)) broken.push(`${key} -> ${form} (missing {${n}})`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});
