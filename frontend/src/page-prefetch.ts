export type PageKey = string;
type PageLoader = () => Promise<unknown>;
type IdleScheduler = (callback: () => void) => void;

export function createPagePrefetcher(loaders: Record<PageKey, PageLoader>) {
  const requested = new Map<PageKey, Promise<unknown>>();

  function prefetch(page: PageKey): Promise<void> {
    const loader = loaders[page];
    if (!loader) return Promise.resolve();
    const request = requested.get(page) ?? loader();
    requested.set(page, request);
    return request.then(() => undefined);
  }

  function prefetchWhenIdle(pages: PageKey[], schedule: IdleScheduler) {
    schedule(() => {
      for (const page of pages) void prefetch(page);
    });
  }

  return { prefetch, prefetchWhenIdle };
}
