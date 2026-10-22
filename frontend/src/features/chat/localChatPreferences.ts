export function readStringMap(storageKey: string): Map<number, string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    const values = new Map<number, string>();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return values;
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key);
      if (Number.isInteger(id) && id > 0 && typeof value === "string" && value) values.set(id, value);
    }
    return values;
  } catch {
    return new Map();
  }
}

export function writeStringMap(storageKey: string, values: Map<number, string>) {
  const payload: Record<string, string> = {};
  for (const [id, text] of values) {
    if (text) payload[String(id)] = text;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

export function readIdList(storageKey: string): number[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

export function writeIdList(storageKey: string, ids: number[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(ids));
}
