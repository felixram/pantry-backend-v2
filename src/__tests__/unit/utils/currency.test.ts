import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isSupportedCurrency,
  normalizeCurrency,
  currencySymbol,
  SUPPORTED_CURRENCIES,
} from "../../../types/currency.ts";
import { formatMoney } from "../../../utils/formatMoney.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("unit | currency: normalizeCurrency / isSupportedCurrency", () => {
  it("passes through supported ISO codes in any case", () => {
    expect(normalizeCurrency("USD")).toBe("USD");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency(" eur ")).toBe("EUR");
  });

  it("maps common symbols and loose spellings", () => {
    expect(normalizeCurrency("$")).toBe("USD");
    expect(normalizeCurrency("US$")).toBe("USD");
    expect(normalizeCurrency("€")).toBe("EUR");
    expect(normalizeCurrency("£")).toBe("GBP");
    expect(normalizeCurrency("CA$")).toBe("CAD");
    expect(normalizeCurrency("dollars")).toBe("USD");
  });

  it("extracts a leading ISO token from labelled text", () => {
    expect(normalizeCurrency("EUR - Euro")).toBe("EUR");
    expect(normalizeCurrency("GBP (British Pound)")).toBe("GBP");
  });

  it("returns null for junk / unknown", () => {
    expect(normalizeCurrency("")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency("banana")).toBeNull();
    expect(normalizeCurrency("XYZ")).toBeNull();
  });

  it("isSupportedCurrency only accepts exact codes", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });

  it("currencySymbol falls back to the code", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("ZZZ")).toBe("ZZZ");
  });

  it("every supported currency has a distinct code", () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("unit | formatMoney", () => {
  it("formats with the right symbol and 2 decimals by default", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(10, "EUR")).toBe("€10.00");
  });

  it("whole option drops the cents", () => {
    expect(formatMoney(1234.56, "USD", { whole: true })).toBe("$1,235");
  });

  it("defaults to USD and coerces non-finite to zero", () => {
    expect(formatMoney(5)).toBe("$5.00");
    expect(formatMoney(NaN, "USD")).toBe("$0.00");
    expect(formatMoney(1, null)).toBe("$1.00");
  });

  it("never throws on a bad currency code", () => {
    expect(() => formatMoney(1, "NOTACODE")).not.toThrow();
  });
});

describe("unit | currency + formatMoney mirrors stay byte-identical", () => {
  const pairs: Array<[string, string]> = [
    ["types/currency.ts", "../v2/src/lib/currency.ts"],
    ["utils/formatMoney.ts", "../v2/src/lib/formatMoney.ts"],
  ];

  for (const [serverRel, clientRel] of pairs) {
    const serverPath = resolve(here, "../../../", serverRel);
    const clientPath = resolve(here, "../../../../", clientRel);
    // The v2 sibling repo isn't present in this repo's CI checkout — the
    // parity check only runs in a local dev tree where both live side by side.
    const runOrSkip = existsSync(clientPath) ? it : it.skip;
    runOrSkip(`${serverRel} === ${clientRel}`, () => {
      expect(readFileSync(clientPath, "utf8")).toBe(readFileSync(serverPath, "utf8"));
    });
  }
});
