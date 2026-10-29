export type ModelCategory = "chat" | "image" | "video";

export const MODEL_CATEGORIES: Array<{ id: ModelCategory; label: string }> = [
  { id: "chat", label: "对话" }, { id: "image", label: "图片" }, { id: "video", label: "视频" }
];

/** Menu categories describe output types, not whether a model accepts images. */
function automaticCategories(name: string, protocol?: string, capabilities?: Record<string, unknown> | null): ModelCategory[] {
  const model = name.trim().toLowerCase().split("/").pop() ?? "";
  if (capabilities?.video_generation === "supported" || /(?:^|[-_.])(?:sora|veo|kling|seedance|cogvideo|ltx-video|hunyuan-video|grok-imagine-video)(?:$|[-_.\d])|^wan[-_.]?\d/.test(model)) return ["video"];
  if (protocol === "images" || /^(?:gpt-image-|chatgpt-image-|dall-e-|imagen[-_.]|flux[-_.]|stable-diffusion|sdxl|sd3[-_.]|qwen-image|z-image|nano-banana|seedream|ideogram|recraft|grok-imagine-image)|^gemini.*[-_.]image(?:$|[-_.])/.test(model)) return ["image"];
  // These Responses models support both conversation and image output.
  if (/^grok-4[.-]7(?:[-.]|$)/.test(model) && capabilities?.image_generation !== "unsupported") return ["chat", "image"];
  if (capabilities?.image_generation === "supported") return ["image"];
  return ["chat"];
}

export function modelCategories(name: string, protocol?: string, capabilities?: Record<string, unknown> | null): ModelCategory[] {
  const inferred = automaticCategories(name, protocol, capabilities);
  const mapping = [["chat", "chat"], ["image", "image_generation"], ["video", "video_generation"]] as const;
  const result = new Set(inferred);
  for (const [type, key] of mapping) {
    if (capabilities?.[key] === "supported") result.add(type);
    if (capabilities?.[key] === "unsupported") result.delete(type);
  }
  return mapping.map(([type]) => type).filter(type => result.has(type));
}

/** Unknown aliases must remain visible as unconfirmed in service management. */
export function inferredOutputTypes(name: string, protocol?: string, capabilities?: Record<string, unknown> | null): ModelCategory[] {
  const types = modelCategories(name, protocol, capabilities);
  const normalized = name.toLowerCase().split("/").pop() || "";
  if (types.length === 1 && types[0] === "chat" && capabilities?.chat !== "supported" && !/^(?:gpt-|chatgpt-|o[134](?:[-_.]|$)|claude|gemini|qwen|deepseek|grok|llama|mistral|mixtral|gemma|glm|kimi|minimax|doubao|yi-|command-r|phi[-.]|ernie)/.test(normalized)) return [];
  return types.filter(type => capabilities?.[({ chat: "chat", image: "image_generation", video: "video_generation" } as const)[type]] !== "unsupported");
}
