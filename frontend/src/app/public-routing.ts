export const productIntroHash = "#/about";

export function isProductIntroHash(hash: string): boolean {
  return hash.split("?")[0].replace(/\/+$/, "") === productIntroHash;
}
