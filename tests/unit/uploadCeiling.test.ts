/**
 * The app's image upload limit stays under Vercel's 4.5 MB request-body
 * limit, so an oversized image gets the app's own "upload limit" message
 * instead of Vercel's bare 413.
 */

import { afterEach, describe, expect, it } from "vitest";
import { UPLOAD_CEILING_MB, imageUploadMaxBytes } from "../../src/services/postImageStorage.js";

const MB = 1024 * 1024;
const VERCEL_BODY_LIMIT = 4.5 * MB;

describe("imageUploadMaxBytes", () => {
  const saved = process.env.IMAGE_UPLOAD_MAX_MB;
  afterEach(() => {
    if (saved === undefined) delete process.env.IMAGE_UPLOAD_MAX_MB;
    else process.env.IMAGE_UPLOAD_MAX_MB = saved;
  });

  it("defaults to the ceiling, under Vercel's limit", () => {
    delete process.env.IMAGE_UPLOAD_MAX_MB;
    expect(imageUploadMaxBytes()).toBe(UPLOAD_CEILING_MB * MB);
    expect(imageUploadMaxBytes()).toBeLessThan(VERCEL_BODY_LIMIT);
  });

  it("lets the env lower it", () => {
    process.env.IMAGE_UPLOAD_MAX_MB = "2";
    expect(imageUploadMaxBytes()).toBe(2 * MB);
  });

  it("never lets the env raise it past the ceiling", () => {
    process.env.IMAGE_UPLOAD_MAX_MB = "5";
    expect(imageUploadMaxBytes()).toBe(UPLOAD_CEILING_MB * MB);
  });

  it("ignores a value that is not a positive number", () => {
    process.env.IMAGE_UPLOAD_MAX_MB = "lots";
    expect(imageUploadMaxBytes()).toBe(UPLOAD_CEILING_MB * MB);
    process.env.IMAGE_UPLOAD_MAX_MB = "0";
    expect(imageUploadMaxBytes()).toBe(UPLOAD_CEILING_MB * MB);
  });
});
