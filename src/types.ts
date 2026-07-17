export type PromptRecord = {
  id: string;
  title: string;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  sortOrder: number;
  pinned?: boolean;
  unpinnedPosition?: number;
};

export type PromptItem = string | PromptRecord;
export type PromptCategories = Record<string, PromptItem[]>;

export type PromptData = {
  _type_order?: string[];
  [typeName: string]: PromptCategories | string[] | undefined;
};

export type AppStatus = {
  encrypted: boolean;
  exists: boolean;
  dataPath: string;
  dataDirectory: string;
  pathConfigurable: boolean;
};

export type WorkspaceTab = {
  id: string;
  typeName: string;
  categoryName: string;
  search: string;
  expandedTypeName?: string;
  customName?: string;
};

export type WorkspaceState = {
  tabs: WorkspaceTab[];
  activeTabId: string;
};

export type PromptLocation = {
  typeName: string;
  categoryName: string;
  index: number;
  prompt: PromptItem;
};

export type ImportStats = {
  types: number;
  categories: number;
  prompts: number;
};
