import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryImageThumbnail } from "./LibraryImageThumbnail";
import type { LibrarySource } from "../../types";

const source = { id: 8, title: "海边照片", mime_type: "image/png", file_available: true, updated_at: "2026-10-29" } as LibrarySource;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads private images only when near the viewport and releases their URLs", async () => {
  let intersect!: (entries: Array<{ isIntersecting: boolean }>) => void;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:private-thumbnail"), revokeObjectURL: revoke });
  const load = vi.fn().mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  const view = render(<LibraryImageThumbnail source={source} loadOriginal={load} />);
  expect(load).not.toHaveBeenCalled();
  const { act } = await import("@testing-library/react");
  act(() => intersect([{ isIntersecting: true }]));
  await waitFor(() => expect(screen.getByRole("img", { name: source.title })).toHaveAttribute("src", "blob:private-thumbnail"));
  expect(load).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }), expect.any(AbortSignal));
  const signal = load.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(revoke).toHaveBeenCalledWith("blob:private-thumbnail");
});

it("keeps a readable fallback when loading or decoding fails", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:broken"), revokeObjectURL: vi.fn() });
  const load = vi.fn().mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  render(<LibraryImageThumbnail source={source} loadOriginal={load} />);
  const image = await screen.findByRole("img", { name: source.title });
  fireEvent.error(image);
  expect(screen.getByText("图片暂不可预览")).toBeInTheDocument();
});

it("cancels pending reads and ignores their late responses", async () => {
  let resolve!: (blob: Blob) => void;
  const create = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const load = vi.fn().mockImplementation(() => new Promise<Blob>((done) => { resolve = done; }));
  const view = render(<LibraryImageThumbnail source={source} loadOriginal={load} />);
  view.unmount();
  resolve(new Blob(["image"], { type: "image/png" }));
  await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
});
