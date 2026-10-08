export type FetchJson = <T>(path: string, options?: RequestInit) => Promise<T>;

export type HomePreferences = {
  topics: string[];
  repositories: string[];
};

export type HomeArticle = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  published_at: string | null;
  category: string;
  tags: string[];
  image_url: string | null;
};

export type HomeRepository = {
  id: string;
  owner: string;
  name: string;
  description: string;
  url: string;
  language: string | null;
  stars: number | null;
  period_stars: number | null;
  forks: number | null;
  rank: number;
  tags: string[];
};

export type HomeRelease = {
  id: string;
  repo: string;
  name: string;
  version: string;
  previous_version: string | null;
  published_at: string | null;
  changes: string[];
  compatibility: "breaking" | "migrate" | "review";
  url: string;
};

export type HomeReadableItem = {
  id: string;
  kind: "article" | "repository" | "release";
  title: string;
  summary: string;
  url: string;
  source: string;
  published_at: string | null;
};

export type SourceStatus = {
  id: string;
  label: string;
  kind: "news" | "github" | "stack" | "practice";
  status: "ready" | "empty" | "error" | "loading";
  url: string;
  last_success_at: string | null;
  error: string | null;
};

export type HomeItemState = {
  bookmarked: boolean;
  hidden: boolean;
};

export type HomeBookmark =
  | { kind: "news" | "practice"; item: HomeArticle }
  | { kind: "github"; item: HomeRepository }
  | { kind: "stack"; item: HomeRelease };

export type HomeFeedResponse = {
  news: HomeArticle[];
  repositories: { day: HomeRepository[]; week: HomeRepository[] };
  updates: HomeRelease[];
  practices: HomeArticle[];
  sources: SourceStatus[];
  preferences: HomePreferences;
  item_states: Record<string, HomeItemState>;
  bookmarks?: HomeBookmark[];
  refreshing: boolean;
  last_synced_at: string | null;
};
