// The `addressSuggest` adapter's fake (ADR-012): no network. Text containing
// "mapbox down" fails; otherwise three addresses that start with the text,
// "in <near>" when a place is given, so a test can see the hub's place
// reached it.

import type { AddressSuggester } from "../addressSuggest.js";

export function fakeAddressSuggest(): AddressSuggester & { calls: number } {
  const fake = {
    name: "fake",
    calls: 0,
    configured: () => true,
    async suggest(text: string, near: string | null): Promise<string[]> {
      fake.calls += 1;
      if (text.toLowerCase().includes("mapbox down")) throw new Error("fake address suggestions: the service failed");
      const where = near ? ` in ${near}` : "";
      return [1, 2, 3].map((n) => `${text.trim()} ${n}${where}`);
    },
  };
  return fake;
}
