// The one-time About-you card is never asked while a new account signs up
// (2026-11-18, Adam: it opened on top of the onboarding word cloud).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("./http", () => ({ request: (...args: unknown[]) => request(...args) }));
vi.mock("../config/hubConfig", () => ({ setting: () => undefined }));
vi.mock("../../../src/shared/aboutYou", () => ({ aboutConfig: () => ({}), asksAnything: () => true }));

async function load() {
  vi.resetModules();
  const mod = await import("./aboutYou");
  const { storeToken } = await import("./tokenStore");
  storeToken("t1");
  const prompt = vi.fn(() => Promise.resolve());
  mod.setAboutYouPrompt(prompt);
  return { ...mod, prompt };
}

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ answers: {}, asked: false });
  window.history.replaceState(null, "", "/process/abc");
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("About you after a sign-up", () => {
  it("asks a member who has not been asked, the first time they take part", async () => {
    const { askAboutYouFirst, prompt } = await load();
    await askAboutYouFirst();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("without an onboarding cloud: not on the action that made them sign up, then on the next", async () => {
    const { askAboutYouFirst, holdAboutYouForSignup, prompt } = await load();
    holdAboutYouForSignup(null);
    await askAboutYouFirst();
    expect(prompt).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    await askAboutYouFirst();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("with an onboarding cloud: not until they leave it", async () => {
    const { askAboutYouFirst, holdAboutYouForSignup, prompt } = await load();
    holdAboutYouForSignup("/wordcloud/w1?onboarding=1&return=%2Fprocess%2Fabc");
    await askAboutYouFirst(); // the vote that made them sign up
    window.history.replaceState(null, "", "/wordcloud/w1?onboarding=1&return=%2Fprocess%2Fabc");
    await askAboutYouFirst(); // their word on the cloud
    await askAboutYouFirst();
    expect(prompt).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/process/abc");
    await askAboutYouFirst();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("never over the onboarding cloud, even after a reload of it", async () => {
    const first = await load();
    first.holdAboutYouForSignup("/wordcloud/w1?onboarding=1");
    await first.askAboutYouFirst();
    window.history.replaceState(null, "", "/wordcloud/w1?onboarding=1");
    const { askAboutYouFirst, prompt } = await load(); // the reload
    await askAboutYouFirst();
    expect(prompt).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
    await askAboutYouFirst();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("names no package: any first stop a package gives is held the same way", async () => {
    const { askAboutYouFirst, holdAboutYouForSignup, prompt } = await load();
    holdAboutYouForSignup("/somewhere/welcome");
    await askAboutYouFirst();
    window.history.replaceState(null, "", "/somewhere/welcome");
    await askAboutYouFirst();
    expect(prompt).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/process/abc");
    await askAboutYouFirst();
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
