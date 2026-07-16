import type {
  ImportStats,
  PromptCategories,
  PromptData,
  PromptItem,
  PromptLocation,
  PromptRecord,
} from "../types";

const LEGACY_CATEGORY_ORDER_KEY = "_category_order";

export const cloneData = (data: PromptData): PromptData => structuredClone(data);

export function createPromptId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createPromptRecord(title: string, content: string): PromptRecord {
  const now = new Date().toISOString();
  return {
    id: createPromptId(),
    title,
    content,
    createdAt: now,
    updatedAt: now,
    sortOrder: 0,
  };
}

export function getTypes(data: PromptData): string[] {
  const available = Object.keys(data).filter(
    (key) => key !== "_type_order" && key !== LEGACY_CATEGORY_ORDER_KEY && isCategories(data[key]),
  );
  const ordered = Array.isArray(data._type_order)
    ? data._type_order.filter((name) => available.includes(name))
    : [];
  return [...ordered, ...available.filter((name) => !ordered.includes(name))];
}

export function isCategories(value: unknown): value is PromptCategories {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

export function getCategories(data: PromptData, typeName: string): PromptCategories {
  const value = data[typeName];
  return isCategories(value) ? value : {};
}

export function getCategoryNames(data: PromptData, typeName: string): string[] {
  return Object.keys(getCategories(data, typeName)).filter(
    (name) => name !== LEGACY_CATEGORY_ORDER_KEY,
  );
}

export function stripLegacyCategoryOrder(data: PromptData): { data: PromptData; changed: boolean } {
  const affectedTypes = getTypes(data).filter((typeName) => (
    Object.prototype.hasOwnProperty.call(getCategories(data, typeName), LEGACY_CATEGORY_ORDER_KEY)
  ));
  const hasTopLevelKey = Object.prototype.hasOwnProperty.call(data, LEGACY_CATEGORY_ORDER_KEY);
  if (!hasTopLevelKey && !affectedTypes.length) return { data, changed: false };

  const next = cloneData(data);
  delete next[LEGACY_CATEGORY_ORDER_KEY];
  for (const typeName of affectedTypes) {
    delete getCategories(next, typeName)[LEGACY_CATEGORY_ORDER_KEY];
  }
  return { data: next, changed: true };
}

function nullableTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizePromptData(data: PromptData): { data: PromptData; changed: boolean } {
  const stripped = stripLegacyCategoryOrder(data);
  const next = cloneData(stripped.data);
  const usedIds = new Set<string>();
  let changed = stripped.changed;

  for (const typeName of getTypes(next)) {
    const categories = getCategories(next, typeName);
    for (const categoryName of getCategoryNames(next, typeName)) {
      const prompts = categories[categoryName];
      prompts.forEach((prompt, index) => {
        const source = typeof prompt === "string" ? null : prompt;
        const sourceId = typeof source?.id === "string" ? source.id.trim() : "";
        const id = sourceId && !usedIds.has(sourceId) ? sourceId : createPromptId();
        const title = typeof source?.title === "string" ? source.title : "";
        const content = typeof prompt === "string"
          ? prompt
          : typeof source?.content === "string" ? source.content : "";
        const createdAt = nullableTimestamp(source?.createdAt);
        const updatedAt = nullableTimestamp(source?.updatedAt);
        const normalized: PromptRecord = {
          ...(source || {}),
          id,
          title,
          content,
          createdAt,
          updatedAt,
          sortOrder: index,
        };

        usedIds.add(id);
        if (
          !source ||
          source.id !== normalized.id ||
          source.title !== normalized.title ||
          source.content !== normalized.content ||
          source.createdAt !== normalized.createdAt ||
          source.updatedAt !== normalized.updatedAt ||
          source.sortOrder !== normalized.sortOrder
        ) {
          prompts[index] = normalized;
          changed = true;
        }
      });
    }
  }

  return changed ? { data: next, changed: true } : { data, changed: false };
}

export function promptTitle(prompt: PromptItem): string {
  return typeof prompt === "string" ? "" : prompt.title || "";
}

export function promptContent(prompt: PromptItem): string {
  return typeof prompt === "string" ? prompt : prompt.content || "";
}

export function isPromptPinned(prompt: PromptItem): boolean {
  return typeof prompt !== "string" && prompt.pinned === true;
}

function promptCreatedAtTime(prompt: PromptItem): number | null {
  if (typeof prompt === "string" || !prompt.createdAt) return null;
  const time = Date.parse(prompt.createdAt);
  return Number.isFinite(time) ? time : null;
}

export function insertPromptByCreatedAt(prompts: PromptItem[], prompt: PromptItem): number {
  const pinned = isPromptPinned(prompt);
  const createdAt = promptCreatedAtTime(prompt);
  const firstUnpinnedIndex = prompts.findIndex((item) => !isPromptPinned(item));
  const groupStart = pinned ? 0 : firstUnpinnedIndex < 0 ? prompts.length : firstUnpinnedIndex;
  const groupEnd = pinned ? firstUnpinnedIndex < 0 ? prompts.length : firstUnpinnedIndex : prompts.length;

  let insertAt = groupEnd;
  if (createdAt !== null) {
    for (let index = groupStart; index < groupEnd; index += 1) {
      const existingTime = promptCreatedAtTime(prompts[index]);
      if (existingTime === null || existingTime < createdAt) {
        insertAt = index;
        break;
      }
    }
  }
  prompts.splice(insertAt, 0, prompt);
  return insertAt;
}

export function withPromptPinned(prompt: PromptItem, pinned: boolean): PromptItem {
  if (typeof prompt === "string") {
    const next = createPromptRecord("", prompt);
    if (pinned) next.pinned = true;
    return next;
  }
  const next = { ...prompt };
  if (pinned) next.pinned = true;
  else delete next.pinned;
  return next;
}

export function samePrompt(a: PromptItem, b: PromptItem): boolean {
  return promptContent(a) === promptContent(b);
}

export function searchPrompts(data: PromptData, query: string): PromptLocation[] {
  const needle = query.trim().toLocaleLowerCase();
  const results: PromptLocation[] = [];
  for (const typeName of getTypes(data)) {
    const categories = getCategories(data, typeName);
    for (const [categoryName, prompts] of Object.entries(categories)) {
      prompts.forEach((prompt, index) => {
        if (
          promptTitle(prompt).toLocaleLowerCase().includes(needle) ||
          promptContent(prompt).toLocaleLowerCase().includes(needle)
        ) {
          results.push({ typeName, categoryName, index, prompt });
        }
      });
    }
  }
  return results;
}

export function countPrompts(data: PromptData): number {
  return getTypes(data).reduce(
    (total, typeName) =>
      total +
      Object.values(getCategories(data, typeName)).reduce(
        (sum, prompts) => sum + prompts.length,
        0,
      ),
    0,
  );
}

export function mergePromptData(
  current: PromptData,
  imported: PromptData,
): { data: PromptData; stats: ImportStats } {
  const next = cloneData(current);
  const stats: ImportStats = { types: 0, categories: 0, prompts: 0 };

  for (const typeName of getTypes(imported)) {
    if (!isCategories(next[typeName])) {
      next[typeName] = {};
      stats.types += 1;
    }
    const target = getCategories(next, typeName);
    const importedCategories = getCategories(imported, typeName);
    for (const categoryName of getCategoryNames(imported, typeName)) {
      const prompts = importedCategories[categoryName];
      if (!Array.isArray(target[categoryName])) {
        target[categoryName] = [];
        stats.categories += 1;
      }
      for (const prompt of prompts) {
        if (!target[categoryName].some((existing) => samePrompt(existing, prompt))) {
          insertPromptByCreatedAt(target[categoryName], prompt);
          stats.prompts += 1;
        }
      }
    }
  }

  const order = getTypes(next);
  next._type_order = order;
  return { data: next, stats };
}
