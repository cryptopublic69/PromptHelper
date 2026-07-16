import type {
  ImportStats,
  PromptCategories,
  PromptData,
  PromptItem,
  PromptLocation,
} from "../types";

export const cloneData = (data: PromptData): PromptData => structuredClone(data);

export function getTypes(data: PromptData): string[] {
  const available = Object.keys(data).filter(
    (key) => key !== "_type_order" && isCategories(data[key]),
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
  return Object.keys(getCategories(data, typeName));
}

export function promptTitle(prompt: PromptItem): string {
  return typeof prompt === "string" ? "" : prompt.title || "";
}

export function promptContent(prompt: PromptItem): string {
  return typeof prompt === "string" ? prompt : prompt.content || "";
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
          target[categoryName].push(prompt);
          stats.prompts += 1;
        }
      }
    }
  }

  const order = getTypes(next);
  next._type_order = order;
  return { data: next, stats };
}
