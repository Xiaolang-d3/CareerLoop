import { describe, expect, it } from "vitest";
import { modelCategories } from "./model-categories";

describe("model output categories", () => {
  it.each(["gpt-5.5", "qwen3-vl", "gemini-3-pro", "custom-video-understanding"])("keeps %s in conversation even when it can see images or videos", name => {
    expect(modelCategories(name, "auto", { vision: "supported" })).toEqual(["chat"]);
  });

  it.each(["gpt-image-1", "openai/gpt-image-2", "gemini-3.1-flash-image-preview", "grok-imagine-image", "flux.1-dev"])("recognizes image output for %s", name => {
    expect(modelCategories(name, "openai")).toEqual(["image"]);
  });

  it("uses configured output capabilities for custom model aliases", () => {
    expect(modelCategories("private-generator", "auto", { image_generation: "supported" })).toEqual(["image"]);
    expect(modelCategories("private-generator", "images")).toEqual(["image"]);
    expect(modelCategories("private-movie", "auto", { video_generation: "supported" })).toEqual(["video"]);
  });

  it.each(["sora-2", "google/veo-3.1-generate-preview", "grok-imagine-video-1.5", "wan2.2-t2v"])("keeps %s out of both conversation and Images API routing", name => {
    expect(modelCategories(name, "images")).toEqual(["video"]);
  });

  it("retains both uses of a known conversational image generator", () => {
    expect(modelCategories("grok-4.7", "responses")).toEqual(["chat", "image"]);
    expect(modelCategories("grok-4.7", "responses", { image_generation: "unsupported" })).toEqual(["chat"]);
  });
});
