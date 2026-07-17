import {
  ArrowRight,
  Check,
  ChevronRight,
  ChevronsUp,
  Copy,
  Download,
  Ellipsis,
  Eye,
  FileText,
  Folder,
  FolderInput,
  GripVertical,
  KeyRound,
  Layers3,
  Library,
  LockKeyhole,
  LockOpen,
  Minus,
  Moon,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIconUrl from "../src-tauri/icons/app-icon.svg";
import "./App.css";
import { api } from "./lib/api";
import {
  cloneData,
  countPrompts,
  createPromptRecord,
  getCategoryNames,
  getCategories,
  getTypes,
  insertPromptByCreatedAt,
  isPromptPinned,
  mergePromptData,
  normalizePromptData,
  promptContent,
  promptTitle,
  searchPrompts,
  withPromptPinned,
} from "./lib/data";
import type {
  AppStatus,
  PromptData,
  PromptItem,
  PromptLocation,
  WorkspaceTab,
  WorkspaceState,
} from "./types";

const FONT_SIZE_STORAGE_KEY = "prompt-helper-v5-font-size";
const THEME_STORAGE_KEY = "prompt-helper-v5-theme";
const appWindow = getCurrentWindow();

type ThemeMode = "dark" | "light";

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createBlankTab = (): WorkspaceTab => ({
  id: makeId(),
  typeName: "",
  categoryName: "",
  search: "",
  expandedTypeName: "",
});

type TabDropPosition = "before" | "after";

const TAB_REORDER_THRESHOLD_PX = 6;

const reorderTabs = (
  tabs: WorkspaceTab[],
  sourceTabId: string,
  targetTabId: string,
  position: TabDropPosition,
): WorkspaceTab[] => {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return tabs;

  const next = [...tabs];
  const [sourceTab] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.findIndex((tab) => tab.id === targetTabId);
  const insertIndex = position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  next.splice(insertIndex, 0, sourceTab);
  return next;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const readInitialFontSize = () => {
  const stored = Number(localStorage.getItem(FONT_SIZE_STORAGE_KEY));
  return Number.isFinite(stored) ? Math.min(20, Math.max(14, stored)) : 16;
};

const readInitialTheme = (): ThemeMode =>
  localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";

type EntityDialog = {
  mode:
    | "add-type"
    | "rename-type"
    | "add-category"
    | "rename-category"
    | "rename-tab";
  initial?: string;
  typeName?: string;
  categoryName?: string;
};

type PromptDialog = {
  mode: "add" | "edit";
  location?: PromptLocation;
};

type Confirmation = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  action: () => void | Promise<void>;
};

type Toast = { kind: "success" | "error" | "info"; message: string };

const runWindowAction = (action: () => Promise<void>) => {
  void action().catch((error) => console.error("Window action failed", error));
};

function WindowControls() {
  return (
    <div className="window-controls">
      <button onClick={() => runWindowAction(() => appWindow.minimize())} title="最小化" aria-label="最小化">
        <Minus size={16} />
      </button>
      <button onClick={() => runWindowAction(() => appWindow.toggleMaximize())} title="最大化或还原" aria-label="最大化或还原">
        <Square size={12} />
      </button>
      <button className="window-close" onClick={() => runWindowAction(() => appWindow.close())} title="关闭" aria-label="关闭">
        <X size={16} />
      </button>
    </div>
  );
}

function StandaloneWindowBar() {
  return (
    <div className="standalone-window-bar">
      <div
        className="standalone-drag-region"
        data-tauri-drag-region
        onDoubleClick={() => runWindowAction(() => appWindow.toggleMaximize())}
      />
      <WindowControls />
    </div>
  );
}

function Modal({
  title,
  subtitle,
  icon,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div className="modal-heading-icon">{icon || <Sparkles size={19} />}</div>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button ghost modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function UnlockScreen({
  status,
  onUnlock,
  onSelectDataDirectory,
  error,
}: {
  status: AppStatus;
  onUnlock: (password: string) => Promise<void>;
  onSelectDataDirectory: () => Promise<void>;
  error: string;
}) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [selectingDirectory, setSelectingDirectory] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status.encrypted && !password) return;
    setWorking(true);
    await onUnlock(password);
    setWorking(false);
  };

  const selectDataDirectory = async () => {
    setSelectingDirectory(true);
    await onSelectDataDirectory();
    setPassword("");
    setSelectingDirectory(false);
  };

  return (
    <main className="unlock-page">
      <StandaloneWindowBar />
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="unlock-card">
        <div className="unlock-mark"><img src={appIconUrl} alt="" /></div>
        <div className="eyebrow">PROMPTHELPER · SECURE LIBRARY</div>
        <h1>{status.encrypted ? "欢迎回来" : status.exists ? "打开资料库" : "开始使用"}</h1>
        <div className="data-location-section">
          <label className="field-label">资料库位置</label>
          <div className="data-location-row">
            <div className="data-location-path" title={status.dataPath}>
              <Folder size={17} />
              <span>{status.dataDirectory}</span>
            </div>
            <button
              type="button"
              className="secondary-button data-location-button"
              onClick={() => void selectDataDirectory()}
              disabled={working || selectingDirectory || !status.pathConfigurable}
              title={status.pathConfigurable ? "选择资料库所在文件夹" : "当前路径由环境变量管理"}
            >
              <FolderInput size={16} />
              {selectingDirectory ? "选择中…" : "选择"}
            </button>
          </div>
          <div className="data-location-hint">
            {status.pathConfigurable && status.exists
              ? "已找到 prompts_data.json；软件会记住此位置"
              : status.pathConfigurable
                ? "此位置尚无资料库；打开后将使用这里的 prompts_data.json"
              : "当前位置由环境变量 PROMPT_HELPER_DATA_FILE 管理"}
          </div>
        </div>
        <form onSubmit={submit}>
          {status.encrypted && <>
            <label className="field-label" htmlFor="unlock-password">资料库密码</label>
            <div className="input-shell prominent">
              <KeyRound size={18} />
              <input
                id="unlock-password"
                autoFocus
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入密码"
              />
            </div>
          </>}
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button unlock-button" disabled={working || (status.encrypted && !password)}>
            {working
              ? status.encrypted ? "正在解锁…" : "正在打开…"
              : status.encrypted ? "解锁资料库" : status.exists ? "打开资料库" : "打开新资料库"}
            <ArrowRight size={17} />
          </button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const [phase, setPhase] = useState<"loading" | "locked" | "ready" | "error">("loading");
  const [fatalError, setFatalError] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [data, setData] = useState<PromptData>({});
  const [password, setPassword] = useState<string | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [entityDialog, setEntityDialog] = useState<EntityDialog | null>(null);
  const [promptDialog, setPromptDialog] = useState<PromptDialog | null>(null);
  const [promptViewer, setPromptViewer] = useState<PromptLocation | null>(null);
  const [moveLocation, setMoveLocation] = useState<PromptLocation | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [importDraft, setImportDraft] = useState<PromptData | null>(null);
  const [securityMode, setSecurityMode] = useState<"manage" | "enable" | "change" | "disable" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState(readInitialFontSize);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [contextMenu, setContextMenu] = useState<({ x: number; y: number } & PromptLocation) | null>(null);
  const [treeActionMenuKey, setTreeActionMenuKey] = useState<string | null>(null);
  const [promptActionMenuKey, setPromptActionMenuKey] = useState<string | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<{ tabId: string; position: TabDropPosition } | null>(null);
  const [dragTypeName, setDragTypeName] = useState<string | null>(null);
  const [typeDropTarget, setTypeDropTarget] = useState<{ typeName: string; position: "before" | "after" } | null>(null);
  const [dragCategory, setDragCategory] = useState<{ typeName: string; categoryName: string } | null>(null);
  const [categoryDropTarget, setCategoryDropTarget] = useState<{ typeName: string; categoryName: string; position: "before" | "after" } | null>(null);
  const [dragPromptIndex, setDragPromptIndex] = useState<number | null>(null);
  const [promptDropTarget, setPromptDropTarget] = useState<{ index: number; position: "before" | "after" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const tabsScrollTargetRef = useRef(0);
  const tabsScrollFrameRef = useRef<number | null>(null);
  const tabsRef = useRef<WorkspaceTab[]>([]);
  const activeTabIdRef = useRef("");
  const workspaceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const allowWindowCloseRef = useRef(false);
  const tabPointerDragRef = useRef<{
    sourceTabId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressTabClickRef = useRef(false);
  const typePointerDragRef = useRef<{
    sourceTypeName: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const categoryPointerDragRef = useRef<{
    typeName: string;
    sourceCategoryName: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const promptPointerDragRef = useRef<{
    typeName: string;
    categoryName: string;
    sourceIndex: number;
    sourcePinned: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const initialiseTabs = async (loaded: PromptData) => {
    const types = getTypes(loaded);
    const fallbackType = types[0] || "";
    const fallbackCategory = getCategoryNames(loaded, fallbackType)[0] || "";
    let restored: WorkspaceTab[] = [];
    let restoredActive: string | null = null;

    try {
      const workspaceState = await api.loadWorkspaceState();
      if (workspaceState && Array.isArray(workspaceState.tabs)) {
        restored = workspaceState.tabs;
        restoredActive = typeof workspaceState.activeTabId === "string"
          ? workspaceState.activeTabId
          : null;
      }
    } catch (error) {
      console.warn("无法读取持久化工作区状态", error);
    }

    const normalised = restored.slice(0, 20).map((tab) => {
      const requestedType = typeof tab.typeName === "string" ? tab.typeName : "";
      const typeName = requestedType
        ? (types.includes(requestedType) ? requestedType : fallbackType)
        : "";
      const categories = getCategoryNames(loaded, typeName);
      return {
        id: typeof tab.id === "string" ? tab.id : makeId(),
        typeName,
        categoryName: typeName
          ? (categories.includes(tab.categoryName) ? tab.categoryName : categories[0] || "")
          : "",
        search: typeof tab.search === "string" ? tab.search : "",
        expandedTypeName: typeof tab.expandedTypeName === "string" && types.includes(tab.expandedTypeName)
          ? tab.expandedTypeName
          : typeName,
        customName: typeof tab.customName === "string" ? tab.customName : undefined,
      };
    });
    const nextTabs = normalised.length
      ? normalised
      : [{ id: makeId(), typeName: fallbackType, categoryName: fallbackCategory, search: "", expandedTypeName: fallbackType }];
    setTabs(nextTabs);
    setActiveTabId(nextTabs.some((tab) => tab.id === restoredActive) ? restoredActive! : nextTabs[0].id);
  };

  useEffect(() => {
    (async () => {
      try {
        const appStatus = await api.status();
        setStatus(appStatus);
        setPhase("locked");
      } catch (error) {
        setFatalError(errorMessage(error));
        setPhase("error");
      }
    })();
  }, []);

  useEffect(() => {
    if (phase !== "ready" || !tabs.length) return;

    const workspaceState: WorkspaceState = { tabs, activeTabId };
    workspaceSaveQueueRef.current = workspaceSaveQueueRef.current
      .catch(() => undefined)
      .then(() => api.saveWorkspaceState(workspaceState))
      .catch((error) => {
        console.error("保存工作区状态失败", error);
      });
  }, [tabs, activeTabId, phase]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void appWindow.onCloseRequested(async (event) => {
      if (allowWindowCloseRef.current) return;
      event.preventDefault();

      try {
        const latestTabs = tabsRef.current;
        const latestActiveTabId = activeTabIdRef.current;
        if (latestTabs.length) {
          await workspaceSaveQueueRef.current;
          await api.saveWorkspaceState({
            tabs: latestTabs,
            activeTabId: latestActiveTabId,
          });
        }
      } catch (error) {
        console.error("关闭前保存工作区状态失败", error);
      } finally {
        allowWindowCloseRef.current = true;
        await appWindow.destroy();
      }
    }).then((stopListening) => {
      unlisten = stopListening;
    });

    return () => unlisten?.();
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setTreeActionMenuKey(null);
      setPromptActionMenuKey(null);
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const smoothScrollTabsTo = useCallback((requestedScrollLeft: number) => {
    const strip = tabsScrollRef.current;
    if (!strip) return;
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
    tabsScrollTargetRef.current = Math.min(
      maxScrollLeft,
      Math.max(0, requestedScrollLeft),
    );
    if (tabsScrollFrameRef.current !== null) return;

    const animate = () => {
      const currentStrip = tabsScrollRef.current;
      if (!currentStrip) {
        tabsScrollFrameRef.current = null;
        return;
      }
      const currentMaxScrollLeft = Math.max(
        0,
        currentStrip.scrollWidth - currentStrip.clientWidth,
      );
      const target = Math.min(
        currentMaxScrollLeft,
        Math.max(0, tabsScrollTargetRef.current),
      );
      tabsScrollTargetRef.current = target;
      const distance = target - currentStrip.scrollLeft;
      if (Math.abs(distance) < 0.5) {
        currentStrip.scrollLeft = target;
        tabsScrollFrameRef.current = null;
        return;
      }
      currentStrip.scrollLeft += distance * 0.24;
      tabsScrollFrameRef.current = window.requestAnimationFrame(animate);
    };

    tabsScrollFrameRef.current = window.requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (phase !== "ready" || !activeTabId) return;
    const strip = tabsScrollRef.current;
    const tab = strip?.querySelector<HTMLElement>(
      `[data-workspace-tab-id="${activeTabId}"]`,
    );
    if (!strip || !tab) return;
    const frame = window.requestAnimationFrame(() => {
      const stripBounds = strip.getBoundingClientRect();
      const tabBounds = tab.getBoundingClientRect();
      if (tabBounds.left < stripBounds.left) {
        smoothScrollTabsTo(strip.scrollLeft + tabBounds.left - stripBounds.left);
      } else if (tabBounds.right > stripBounds.right) {
        smoothScrollTabsTo(strip.scrollLeft + tabBounds.right - stripBounds.right);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTabId, phase, smoothScrollTabsTo, tabs.length]);

  useEffect(() => () => {
    if (tabsScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(tabsScrollFrameRef.current);
    }
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const types = useMemo(() => getTypes(data), [data]);
  const categoryPrompts = activeTab
    ? getCategories(data, activeTab.typeName)[activeTab.categoryName] || []
    : [];
  const visiblePrompts = useMemo<PromptLocation[]>(() => {
    if (!activeTab) return [];
    if (activeTab.search.trim()) return searchPrompts(data, activeTab.search);
    return categoryPrompts.map((prompt, index) => ({
      typeName: activeTab.typeName,
      categoryName: activeTab.categoryName,
      index,
      prompt,
    }));
  }, [activeTab, categoryPrompts, data]);

  const unlock = async (value: string) => {
    try {
      setUnlockError("");
      const loaded = await api.load(value);
      setPassword(value || null);
      setData(loaded);
      await initialiseTabs(loaded);
      setPhase("ready");
    } catch (error) {
      setUnlockError(errorMessage(error));
    }
  };

  const selectDataDirectory = async () => {
    try {
      setUnlockError("");
      const selected = await open({
        multiple: false,
        directory: true,
        defaultPath: status?.dataDirectory,
        title: "选择 PromptHelper 资料库文件夹",
      });
      if (typeof selected !== "string") return;

      const nextStatus = await api.setDataDirectory(selected);
      setStatus(nextStatus);
      setPassword(null);
      setPhase("locked");
    } catch (error) {
      setUnlockError(errorMessage(error));
    }
  };

  const persist = async (next: PromptData, message: string, nextPassword = password) => {
    const cleaned = normalizePromptData(next).data;
    setBusy(true);
    try {
      await api.save(cleaned, nextPassword);
      setData(cleaned);
      setToast({ kind: "success", message });
      return true;
    } catch (error) {
      setToast({ kind: "error", message: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== "ready" || busy) return;
    const normalized = normalizePromptData(data);
    if (normalized.changed) void persist(normalized.data, "已升级资料记录结构");
  }, [data, phase]);

  const patchTab = (id: string, patch: Partial<WorkspaceTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  };

  const toggleType = (typeName: string) => {
    if (!activeTab) return;
    patchTab(activeTab.id, {
      expandedTypeName: activeTab.expandedTypeName === typeName ? "" : typeName,
    });
  };

  const selectCategory = (typeName: string, categoryName: string) => {
    if (!activeTab) return;
    patchTab(activeTab.id, { typeName, categoryName, search: "", expandedTypeName: typeName });
  };

  const addTab = () => {
    const tab = createBlankTab();
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  };

  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    if (tabs.length === 1) {
      const blankTab = createBlankTab();
      setTabs([blankTab]);
      setActiveTabId(blankTab.id);
      return;
    }

    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (id === activeTabId) setActiveTabId(next[Math.min(index, next.length - 1)].id);
  };

  const clearTabPointerDrag = useCallback(() => {
    tabPointerDragRef.current = null;
    document.documentElement.classList.remove("tab-pointer-dragging");
    setDragTabId(null);
    setTabDropTarget(null);
  }, []);

  const resolveTabDropTarget = useCallback((
    sourceTabId: string,
    clientX: number,
    clientY: number,
  ): { tabId: string; position: TabDropPosition } | null => {
    const targetElement = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>(".workspace-tab[data-workspace-tab-id]");
    const targetTabId = targetElement?.dataset.workspaceTabId;
    if (!targetElement || !targetTabId || targetTabId === sourceTabId) return null;

    const bounds = targetElement.getBoundingClientRect();
    return {
      tabId: targetTabId,
      position: clientX < bounds.left + bounds.width / 2 ? "before" : "after",
    };
  }, []);

  const maybeAutoScrollTabs = useCallback((clientX: number) => {
    const strip = tabsScrollRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const bounds = strip.getBoundingClientRect();
    const edgeSize = 42;
    if (clientX < bounds.left + edgeSize) {
      smoothScrollTabsTo(strip.scrollLeft - edgeSize);
    } else if (clientX > bounds.right - edgeSize) {
      smoothScrollTabsTo(strip.scrollLeft + edgeSize);
    }
  }, [smoothScrollTabsTo]);

  const handleTabPointerDown = useCallback((
    tabId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0 || !event.isPrimary || tabs.length < 2) return;
    tabPointerDragRef.current = {
      sourceTabId: tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setTabDropTarget(null);
  }, [tabs.length]);

  const handleTabPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = tabPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < TAB_REORDER_THRESHOLD_PX) return;
      drag.active = true;
      document.documentElement.classList.add("tab-pointer-dragging");
      setDragTabId(drag.sourceTabId);
    }

    event.preventDefault();
    event.stopPropagation();
    maybeAutoScrollTabs(event.clientX);
    setTabDropTarget(resolveTabDropTarget(drag.sourceTabId, event.clientX, event.clientY));
  }, [maybeAutoScrollTabs, resolveTabDropTarget]);

  const handleTabPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = tabPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasActive = drag.active;
    const target = wasActive
      ? resolveTabDropTarget(drag.sourceTabId, event.clientX, event.clientY)
      : null;

    if (wasActive) {
      event.preventDefault();
      event.stopPropagation();
      suppressTabClickRef.current = true;
      window.setTimeout(() => {
        suppressTabClickRef.current = false;
      }, 0);
    } else {
      setActiveTabId(drag.sourceTabId);
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearTabPointerDrag();
    if (target) {
      setTabs((current) => reorderTabs(
        current,
        drag.sourceTabId,
        target.tabId,
        target.position,
      ));
    }
  }, [clearTabPointerDrag, resolveTabDropTarget]);

  const handleTabPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (tabPointerDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearTabPointerDrag();
  }, [clearTabPointerDrag]);

  useEffect(() => () => {
    document.documentElement.classList.remove("tab-pointer-dragging");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (phase !== "ready" || entityDialog || promptDialog || promptViewer || confirmation || moveLocation || importDraft || securityMode || settingsOpen) return;
      if (event.ctrlKey && event.key.toLowerCase() === "t") {
        event.preventDefault(); addTab();
      } else if (event.ctrlKey && event.key.toLowerCase() === "w") {
        event.preventDefault(); if (activeTab) closeTab(activeTab.id);
      } else if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reconcileTabs = (next: PromptData, preferredType?: string, preferredCategory?: string) => {
    const nextTypes = getTypes(next);
    setTabs((current) => current.map((tab) => {
      const typeName = preferredType || (
        tab.typeName
          ? (nextTypes.includes(tab.typeName) ? tab.typeName : nextTypes[0] || "")
          : ""
      );
      const categories = getCategoryNames(next, typeName);
      const categoryName = preferredCategory && categories.includes(preferredCategory)
        ? preferredCategory
        : typeName && categories.includes(tab.categoryName)
          ? tab.categoryName
          : typeName ? categories[0] || "" : "";
      const expandedTypeName = tab.expandedTypeName && nextTypes.includes(tab.expandedTypeName)
        ? tab.expandedTypeName
        : typeName;
      return { ...tab, typeName, categoryName, expandedTypeName };
    }));
  };

  const resolveTypeDropTarget = (sourceTypeName: string, clientX: number, clientY: number) => {
    const group = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>(".tree-type-group[data-type-name]");
    const targetTypeName = group?.dataset.typeName;
    if (!group || !targetTypeName || targetTypeName === sourceTypeName) return null;

    const row = group.querySelector<HTMLElement>(":scope > .tree-type-row");
    if (!row) return null;
    const bounds = row.getBoundingClientRect();
    return {
      typeName: targetTypeName,
      position: clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const,
    };
  };

  const clearTypePointerDrag = () => {
    typePointerDragRef.current = null;
    document.documentElement.classList.remove("type-pointer-dragging");
    setDragTypeName(null);
    setTypeDropTarget(null);
  };

  const moveDraggedType = async (sourceTypeName: string, targetTypeName: string, position: "before" | "after") => {
    if (sourceTypeName === targetTypeName) return;

    const currentOrder = getTypes(data);
    const nextOrder = currentOrder.filter((name) => name !== sourceTypeName);
    const targetIndex = nextOrder.indexOf(targetTypeName);
    if (targetIndex < 0) return;
    nextOrder.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, sourceTypeName);
    if (nextOrder.every((name, index) => name === currentOrder[index])) return;

    const next = cloneData(data);
    next._type_order = nextOrder;
    await persist(next, "类型显示顺序已更新");
  };

  const resolveCategoryDropTarget = (typeName: string, sourceCategoryName: string, clientX: number, clientY: number) => {
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>(".tree-category-row[data-type-name][data-category-name]");
    const targetTypeName = row?.dataset.typeName;
    const targetCategoryName = row?.dataset.categoryName;
    if (!row || targetTypeName !== typeName || !targetCategoryName || targetCategoryName === sourceCategoryName) return null;

    const bounds = row.getBoundingClientRect();
    return {
      typeName,
      categoryName: targetCategoryName,
      position: clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const,
    };
  };

  const clearCategoryPointerDrag = () => {
    categoryPointerDragRef.current = null;
    document.documentElement.classList.remove("type-pointer-dragging");
    setDragCategory(null);
    setCategoryDropTarget(null);
  };

  const moveDraggedCategory = async (typeName: string, sourceCategoryName: string, targetCategoryName: string, position: "before" | "after") => {
    if (sourceCategoryName === targetCategoryName) return;

    const currentOrder = getCategoryNames(data, typeName);
    const nextOrder = currentOrder.filter((name) => name !== sourceCategoryName);
    const targetIndex = nextOrder.indexOf(targetCategoryName);
    if (targetIndex < 0) return;
    nextOrder.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, sourceCategoryName);
    if (nextOrder.every((name, index) => name === currentOrder[index])) return;

    const next = cloneData(data);
    const categories = getCategories(next, typeName);
    next[typeName] = Object.fromEntries(nextOrder.map((name) => [name, categories[name]]));
    await persist(next, "分类显示顺序已更新");
  };

  const saveEntity = async (value: string) => {
    if (!activeTab || !entityDialog) return;
    const name = value.trim();
    if (!name) return;
    const next = cloneData(data);
    const mode = entityDialog.mode;
    if (mode === "rename-tab") {
      patchTab(activeTab.id, { customName: name });
      setEntityDialog(null);
      return;
    }
    if (mode === "add-type") {
      if (types.includes(name)) return setToast({ kind: "error", message: "该类型已存在" });
      next[name] = {};
      next._type_order = [...getTypes(data), name];
      if (await persist(next, `已新增类型「${name}」`)) {
        patchTab(activeTab.id, { typeName: name, categoryName: "", search: "", expandedTypeName: name });
      }
    } else if (mode === "rename-type") {
      const oldName = entityDialog.typeName || activeTab.typeName;
      if (name !== oldName && types.includes(name)) return setToast({ kind: "error", message: "该类型已存在" });
      next[name] = next[oldName];
      if (name !== oldName) {
        delete next[oldName];
      }
      next._type_order = getTypes(data).map((item) => item === oldName ? name : item);
      if (await persist(next, `类型已重命名为「${name}」`)) {
        setTabs((current) => current.map((tab) => ({
          ...tab,
          typeName: tab.typeName === oldName ? name : tab.typeName,
          expandedTypeName: tab.expandedTypeName === oldName ? name : tab.expandedTypeName,
        })));
      }
    } else if (mode === "add-category") {
      const targetTypeName = entityDialog.typeName || activeTab.typeName;
      const categories = getCategories(next, targetTypeName);
      if (categories[name]) return setToast({ kind: "error", message: "该分类已存在" });
      categories[name] = [];
      if (await persist(next, `已新增分类「${name}」`)) selectCategory(targetTypeName, name);
    } else if (mode === "rename-category") {
      const targetTypeName = entityDialog.typeName || activeTab.typeName;
      const oldName = entityDialog.categoryName || activeTab.categoryName;
      const categories = getCategories(next, targetTypeName);
      if (name !== oldName && categories[name]) return setToast({ kind: "error", message: "该分类已存在" });
      if (name !== oldName) {
        next[targetTypeName] = Object.fromEntries(
          getCategoryNames(next, targetTypeName).map((item) => [item === oldName ? name : item, categories[item]]),
        );
      }
      if (await persist(next, `分类已重命名为「${name}」`)) {
        setTabs((current) => current.map((tab) =>
          tab.typeName === targetTypeName && tab.categoryName === oldName
            ? { ...tab, categoryName: name }
            : tab,
        ));
      }
    }
    setEntityDialog(null);
  };

  const deleteType = (typeName: string) => {
    if (!typeName) return;
    setConfirmation({
      title: "删除整个类型？",
      message: `「${typeName}」下的全部分类和提示词都会永久删除。`,
      confirmLabel: "删除类型",
      danger: true,
      action: async () => {
        const next = cloneData(data);
        delete next[typeName];
        next._type_order = getTypes(data).filter((name) => name !== typeName);
        if (await persist(next, `已删除类型「${typeName}」`)) reconcileTabs(next);
      },
    });
  };

  const deleteCategory = (typeName: string, categoryName: string) => {
    if (!typeName || !categoryName) return;
    setConfirmation({
      title: "删除这个分类？",
      message: `「${categoryName}」内的全部提示词都会永久删除。`,
      confirmLabel: "删除分类",
      danger: true,
      action: async () => {
        const next = cloneData(data);
        delete getCategories(next, typeName)[categoryName];
        if (await persist(next, `已删除分类「${categoryName}」`)) reconcileTabs(next);
      },
    });
  };

  const savePrompt = async (title: string, content: string) => {
    if (!activeTab || !promptDialog || (!title.trim() && !content.trim())) return;
    const next = cloneData(data);
    const newPrompt = createPromptRecord(title.trim(), content.trim());
    if (promptDialog.mode === "add") {
      const prompts = getCategories(next, activeTab.typeName)[activeTab.categoryName];
      insertPromptByCreatedAt(prompts, newPrompt);
      await persist(next, "提示词已添加");
    } else if (promptDialog.location) {
      const { typeName, categoryName, index } = promptDialog.location;
      const prompts = getCategories(next, typeName)[categoryName];
      const existing = prompts[index];
      const now = new Date().toISOString();
      prompts[index] = typeof existing === "string"
        ? { ...newPrompt, createdAt: null, updatedAt: now, sortOrder: index }
        : {
            ...existing,
            title: newPrompt.title,
            content: newPrompt.content,
            updatedAt: now,
          };
      await persist(next, "提示词已更新");
    }
    setPromptDialog(null);
  };

  const deletePrompt = async (location: PromptLocation) => {
    const next = cloneData(data);
    const prompts = getCategories(next, location.typeName)[location.categoryName];
    if (!prompts || !prompts[location.index]) return;
    prompts.splice(location.index, 1);
    await persist(next, "提示词已删除");
  };

  const togglePromptPin = async (location: PromptLocation) => {
    const next = cloneData(data);
    const prompts = getCategories(next, location.typeName)[location.categoryName];
    if (!prompts || !prompts[location.index]) return;

    const wasPinned = isPromptPinned(prompts[location.index]);
    const firstUnpinnedBefore = prompts.findIndex((item) => !isPromptPinned(item));
    const [prompt] = prompts.splice(location.index, 1);
    const updated = withPromptPinned(prompt, !wasPinned);
    if (!wasPinned) {
      if (typeof updated !== "string") {
        updated.unpinnedPosition = Math.max(
          0,
          location.index - (firstUnpinnedBefore < 0 ? location.index : firstUnpinnedBefore),
        );
      }
      prompts.unshift(updated);
    } else {
      const savedPosition = typeof prompt !== "string" && Number.isInteger(prompt.unpinnedPosition)
        ? Math.max(0, prompt.unpinnedPosition!)
        : 0;
      if (typeof updated !== "string") delete updated.unpinnedPosition;
      const firstUnpinnedIndex = prompts.findIndex((item) => !isPromptPinned(item));
      const groupStart = firstUnpinnedIndex < 0 ? prompts.length : firstUnpinnedIndex;
      const unpinnedCount = prompts.length - groupStart;
      prompts.splice(groupStart + Math.min(savedPosition, unpinnedCount), 0, updated);
    }
    await persist(next, wasPinned ? "已取消 Pin" : "已 Pin 到分类顶部");
  };

  const movePromptToTop = async (location: PromptLocation) => {
    const next = cloneData(data);
    const prompts = getCategories(next, location.typeName)[location.categoryName];
    if (!prompts || !prompts[location.index]) return;

    const [prompt] = prompts.splice(location.index, 1);
    if (isPromptPinned(prompt)) {
      prompts.unshift(prompt);
    } else {
      const firstUnpinnedIndex = prompts.findIndex((item) => !isPromptPinned(item));
      prompts.splice(firstUnpinnedIndex < 0 ? prompts.length : firstUnpinnedIndex, 0, prompt);
    }
    await persist(next, "提示词已置顶");
  };

  const resolvePromptDropTarget = (
    sourceIndex: number,
    sourcePinned: boolean,
    clientX: number,
    clientY: number,
  ) => {
    const card = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>(".prompt-card[data-prompt-index]");
    const targetIndex = Number(card?.dataset.promptIndex);
    if (!card || !Number.isInteger(targetIndex) || targetIndex === sourceIndex) return null;
    if ((card.dataset.promptPinned === "true") !== sourcePinned) return null;

    const bounds = card.getBoundingClientRect();
    return {
      index: targetIndex,
      position: clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const,
    };
  };

  const clearPromptPointerDrag = () => {
    promptPointerDragRef.current = null;
    document.documentElement.classList.remove("type-pointer-dragging");
    setDragPromptIndex(null);
    setPromptDropTarget(null);
  };

  const moveDraggedPrompt = async (
    typeName: string,
    categoryName: string,
    sourceIndex: number,
    targetIndex: number,
    position: "before" | "after",
  ) => {
    if (sourceIndex === targetIndex) return;

    const next = cloneData(data);
    const prompts = getCategories(next, typeName)[categoryName];
    if (!prompts || !prompts[sourceIndex] || !prompts[targetIndex]) return;
    if (isPromptPinned(prompts[sourceIndex]) !== isPromptPinned(prompts[targetIndex])) return;

    const [moved] = prompts.splice(sourceIndex, 1);
    let insertAt = targetIndex - (sourceIndex < targetIndex ? 1 : 0);
    if (position === "after") insertAt += 1;
    prompts.splice(insertAt, 0, moved);
    await persist(next, "提示词顺序已更新");
  };

  const requestDeletePrompt = (location: PromptLocation) => setConfirmation({
    title: "删除这条提示词？",
    message: promptTitle(location.prompt) || promptContent(location.prompt).slice(0, 72),
    confirmLabel: "确认删除",
    danger: true,
    action: () => deletePrompt(location),
  });

  const movePrompt = async (targetType: string, targetCategory: string) => {
    if (!moveLocation) return;
    const next = cloneData(data);
    const source = getCategories(next, moveLocation.typeName)[moveLocation.categoryName];
    const [moved] = source.splice(moveLocation.index, 1);
    const target = getCategories(next, targetType)[targetCategory];
    if (isPromptPinned(moved)) {
      const firstUnpinnedIndex = target.findIndex((prompt) => !isPromptPinned(prompt));
      target.splice(firstUnpinnedIndex < 0 ? target.length : firstUnpinnedIndex, 0, moved);
    } else {
      insertPromptByCreatedAt(target, moved);
    }
    if (await persist(next, `已移动到「${targetType} / ${targetCategory}」`)) setMoveLocation(null);
  };

  const copyPrompt = async (prompt: PromptItem) => {
    try {
      await writeText(promptContent(prompt));
      setToast({ kind: "success", message: `已复制：${promptContent(prompt).slice(0, 44)}${promptContent(prompt).length > 44 ? "…" : ""}` });
    } catch (error) {
      setToast({ kind: "error", message: errorMessage(error) });
    }
  };

  const importFile = async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: "JSON 文件", extensions: ["json"] }] });
      if (typeof path === "string") setImportDraft(await api.importPlaintext(path));
    } catch (error) {
      setToast({ kind: "error", message: errorMessage(error) });
    }
  };

  const applyImport = async (mode: "merge" | "replace") => {
    if (!importDraft) return;
    const result = mode === "merge" ? mergePromptData(data, importDraft) : { data: importDraft, stats: null };
    if (await persist(result.data, mode === "merge"
      ? `合并完成：新增 ${result.stats!.types} 类型、${result.stats!.categories} 分类、${result.stats!.prompts} 条提示词`
      : "已用导入文件覆盖当前资料库")) {
      reconcileTabs(result.data);
      setImportDraft(null);
    }
  };

  const exportFile = async () => {
    try {
      const path = await save({ defaultPath: "prompts_data_export.json", filters: [{ name: "JSON 文件", extensions: ["json"] }] });
      if (path) {
        await api.exportPlaintext(path, data);
        setToast({ kind: "success", message: "资料库已导出为明文 JSON" });
      }
    } catch (error) {
      setToast({ kind: "error", message: errorMessage(error) });
    }
  };

  const applySecurity = async (mode: "enable" | "change" | "disable", values: { current?: string; next?: string; confirm?: string }) => {
    if (mode !== "enable" && values.current !== password) {
      setToast({ kind: "error", message: "当前密码不正确" }); return;
    }
    if (mode !== "disable") {
      if (!values.next || values.next.length < 4) return setToast({ kind: "error", message: "新密码至少需要 4 个字符" });
      if (values.next !== values.confirm) return setToast({ kind: "error", message: "两次输入的新密码不一致" });
    }
    const nextPassword = mode === "disable" ? null : values.next!;
    if (await persist(data, mode === "disable" ? "数据加密已关闭" : mode === "enable" ? "数据加密已启用" : "密码已修改", nextPassword)) {
      setPassword(nextPassword);
      setStatus((current) => current ? { ...current, encrypted: Boolean(nextPassword) } : current);
      setSecurityMode(null);
    }
  };

  if (phase === "loading") return <main className="loading-page"><StandaloneWindowBar /><div className="loader" /><p>正在打开提示词资料库…</p></main>;
  if (phase === "error" || !status) return <main className="loading-page error-page"><StandaloneWindowBar /><ShieldCheck size={36} /><h1>无法启动 PromptHelper</h1><p>{fatalError}</p></main>;
  if (phase === "locked") return <UnlockScreen status={status} onUnlock={unlock} onSelectDataDirectory={selectDataDirectory} error={unlockError} />;
  if (!activeTab) return null;

  const categoryCount = types.reduce((total, type) => total + Object.keys(getCategories(data, type)).length, 0);
  const displayTitle = activeTab.search
    ? `搜索「${activeTab.search}」`
    : activeTab.categoryName || activeTab.typeName || "选择一个类型";

  return (
    <main className="app-shell">
      <div className="top-bar">
        <div
          className="tabs-zone"
          data-tauri-drag-region
          onDoubleClick={(event) => {
            if (event.target === event.currentTarget) {
              runWindowAction(() => appWindow.toggleMaximize());
            }
          }}
        >
          <div
            className="tabs-scroll"
            ref={tabsScrollRef}
            role="tablist"
            aria-label="工作标签"
            onWheel={(event) => {
              const strip = event.currentTarget;
              if (strip.scrollWidth <= strip.clientWidth) return;
              const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
                ? event.deltaX
                : event.deltaY;
              if (!delta) return;
              event.preventDefault();
              const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 18
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                  ? strip.clientWidth
                  : 1;
              const animationBase = tabsScrollFrameRef.current === null
                ? strip.scrollLeft
                : tabsScrollTargetRef.current;
              smoothScrollTabsTo(animationBase + delta * deltaScale);
            }}
          >
            {tabs.map((tab) => {
              const label = tab.customName || tab.typeName || "新标签";
              const directoryTitle = [tab.typeName, tab.categoryName].filter(Boolean).join(" / ") || "新标签";
              const isActive = tab.id === activeTabId;
              const isDragging = tab.id === dragTabId;
              const dropPosition = tabDropTarget?.tabId === tab.id
                ? tabDropTarget.position
                : null;
              return <div
                key={tab.id}
                data-workspace-tab-id={tab.id}
                className={`workspace-tab${isActive ? " active" : ""}${isDragging ? " dragging" : ""}${dropPosition ? ` drop-${dropPosition}` : ""}`}
                aria-grabbed={isDragging || undefined}
              >
                <button
                  type="button"
                  className="workspace-tab-main"
                  role="tab"
                  aria-selected={isActive}
                  title={directoryTitle}
                  onPointerDown={(event) => handleTabPointerDown(tab.id, event)}
                  onPointerMove={handleTabPointerMove}
                  onPointerUp={handleTabPointerUp}
                  onPointerCancel={handleTabPointerCancel}
                  onClick={(event) => {
                    if (suppressTabClickRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    setActiveTabId(tab.id);
                  }}
                  onDoubleClick={() => {
                    setActiveTabId(tab.id);
                    setEntityDialog({ mode: "rename-tab", initial: label });
                  }}
                  onMouseDown={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    closeTab(tab.id);
                  }}
                >
                  <span className="workspace-tab-title">{label}</span>
                </button>
                <button
                  type="button"
                  className="workspace-tab-close"
                  title={`关闭标签：${label}`}
                  aria-label={`关闭标签：${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={13} />
                </button>
              </div>;
            })}
          </div>
          <button className="new-tab" onClick={addTab} title="新建标签 (Ctrl+T)"><Plus size={17} /></button>
        </div>
        <div className="library-actions">
          <button onClick={importFile} title="导入 JSON"><Download size={17} /></button>
          <button onClick={exportFile} title="导出明文 JSON"><Upload size={17} /></button>
          <button onClick={() => setSecurityMode("manage")} title="数据安全"><ShieldCheck size={18} /></button>
          <button onClick={() => setSettingsOpen(true)} title="设置"><Settings size={18} /></button>
        </div>
        <WindowControls />
      </div>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src={appIconUrl} alt="" /></div>
          <div><strong>PromptHelper</strong><span>提示词工作台 · V5</span></div>
        </div>

        <div className="library-overview">
          <Library size={14} />
          <span>{types.length} 类型</span><i />
          <span>{categoryCount} 分类</span><i />
          <strong>{countPrompts(data)} 条</strong>
        </div>

        <section className="sidebar-section library-tree-section">
          <header><span>资料库</span><div className="section-actions">
            <button onClick={() => setEntityDialog({ mode: "add-type" })} title="新增类型"><Plus size={16} /></button>
          </div></header>
          <div className="tree-nav">
            {types.map((typeName) => {
              const categories = getCategoryNames(data, typeName);
              const promptCount = Object.values(getCategories(data, typeName)).reduce((sum, prompts) => sum + prompts.length, 0);
              const expanded = activeTab.expandedTypeName === typeName;
              const containsActive = activeTab.typeName === typeName;
              const typeActionsKey = `type:${typeName}`;
              const typeActionsOpen = treeActionMenuKey === typeActionsKey;
              return <div
                className={`tree-type-group ${expanded ? "expanded-group" : ""}`}
                key={typeName}
                data-type-name={typeName}
              >
                <div
                  className={`tree-type-row ${expanded ? "expanded" : ""} ${containsActive ? "contains-active" : ""} ${typeActionsOpen ? "actions-open" : ""} ${dragTypeName === typeName ? "dragging" : ""} ${typeDropTarget?.typeName === typeName ? `drop-${typeDropTarget.position}` : ""}`}
                  onMouseEnter={() => setTreeActionMenuKey((current) => (
                    current && current !== typeActionsKey ? null : current
                  ))}
                  onMouseLeave={() => setTreeActionMenuKey((current) => (
                    current === typeActionsKey ? null : current
                  ))}
                >
                  <button
                    className="tree-drag-handle"
                    onPointerDown={(event) => {
                      if (!event.isPrimary || event.button !== 0 || types.length < 2) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setTreeActionMenuKey(null);
                      typePointerDragRef.current = {
                        sourceTypeName: typeName,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        active: false,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                      document.documentElement.classList.add("type-pointer-dragging");
                      setTypeDropTarget(null);
                    }}
                    onPointerMove={(event) => {
                      const drag = typePointerDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      if (!drag.active) {
                        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
                        drag.active = true;
                        setDragTypeName(drag.sourceTypeName);
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      const target = resolveTypeDropTarget(drag.sourceTypeName, event.clientX, event.clientY);
                      setTypeDropTarget((current) => (
                        current?.typeName === target?.typeName && current?.position === target?.position
                          ? current
                          : target
                      ));
                    }}
                    onPointerUp={(event) => {
                      const drag = typePointerDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      const target = drag.active
                        ? resolveTypeDropTarget(drag.sourceTypeName, event.clientX, event.clientY)
                        : null;
                      if (drag.active) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      clearTypePointerDrag();
                      if (target) void moveDraggedType(drag.sourceTypeName, target.typeName, target.position);
                    }}
                    onPointerCancel={(event) => {
                      if (typePointerDragRef.current?.pointerId !== event.pointerId) return;
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      clearTypePointerDrag();
                    }}
                    title="拖动调整类型顺序"
                    aria-label={`拖动调整「${typeName}」顺序`}
                  ><GripVertical size={13} /></button>
                  <button className="tree-type-main" onClick={() => toggleType(typeName)} aria-expanded={expanded}>
                    <ChevronRight className="tree-chevron" size={14} />
                    <Layers3 size={15} />
                    <span>{typeName}</span>
                    <em>{promptCount}</em>
                  </button>
                  <button
                    className={`tree-actions-trigger ${typeActionsOpen ? "open" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setTreeActionMenuKey((current) => current === typeActionsKey ? null : typeActionsKey);
                    }}
                    title="更多操作"
                    aria-label={`打开「${typeName}」操作`}
                    aria-expanded={typeActionsOpen}
                  ><Ellipsis size={15} /></button>
                  <div className={`tree-row-actions ${typeActionsOpen ? "open" : ""}`}>
                    <button onClick={() => setEntityDialog({ mode: "add-category", typeName })} title="新增分类"><Plus size={13} /></button>
                    <button onClick={() => setEntityDialog({ mode: "rename-type", initial: typeName, typeName })} title="重命名类型"><Pencil size={13} /></button>
                    <button className="danger" onClick={() => deleteType(typeName)} title="删除类型"><Trash2 size={13} /></button>
                  </div>
                </div>
                {expanded && <div className="tree-category-list">
                  {categories.map((categoryName) => {
                    const active = activeTab.typeName === typeName && activeTab.categoryName === categoryName && !activeTab.search;
                    const categoryActionsKey = `category:${typeName}\u0000${categoryName}`;
                    const categoryActionsOpen = treeActionMenuKey === categoryActionsKey;
                    const categoryDragging = dragCategory?.typeName === typeName && dragCategory.categoryName === categoryName;
                    const categoryTarget = categoryDropTarget?.typeName === typeName && categoryDropTarget.categoryName === categoryName;
                    return <div
                      className={`tree-category-row ${active ? "active" : ""} ${categoryActionsOpen ? "actions-open" : ""} ${categoryDragging ? "dragging" : ""} ${categoryTarget ? `drop-${categoryDropTarget.position}` : ""}`}
                      key={categoryName}
                      data-type-name={typeName}
                      data-category-name={categoryName}
                      onMouseEnter={() => setTreeActionMenuKey((current) => (
                        current && current !== categoryActionsKey ? null : current
                      ))}
                      onMouseLeave={() => setTreeActionMenuKey((current) => (
                        current === categoryActionsKey ? null : current
                      ))}
                    >
                      <button
                        className="tree-category-drag-handle"
                        onPointerDown={(event) => {
                          if (!event.isPrimary || event.button !== 0 || categories.length < 2) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setTreeActionMenuKey(null);
                          categoryPointerDragRef.current = {
                            typeName,
                            sourceCategoryName: categoryName,
                            pointerId: event.pointerId,
                            startX: event.clientX,
                            startY: event.clientY,
                            active: false,
                          };
                          event.currentTarget.setPointerCapture(event.pointerId);
                          document.documentElement.classList.add("type-pointer-dragging");
                          setCategoryDropTarget(null);
                        }}
                        onPointerMove={(event) => {
                          const drag = categoryPointerDragRef.current;
                          if (!drag || drag.pointerId !== event.pointerId) return;
                          if (!drag.active) {
                            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
                            drag.active = true;
                            setDragCategory({ typeName: drag.typeName, categoryName: drag.sourceCategoryName });
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          const target = resolveCategoryDropTarget(drag.typeName, drag.sourceCategoryName, event.clientX, event.clientY);
                          setCategoryDropTarget((current) => (
                            current?.typeName === target?.typeName && current?.categoryName === target?.categoryName && current?.position === target?.position
                              ? current
                              : target
                          ));
                        }}
                        onPointerUp={(event) => {
                          const drag = categoryPointerDragRef.current;
                          if (!drag || drag.pointerId !== event.pointerId) return;
                          const target = drag.active
                            ? resolveCategoryDropTarget(drag.typeName, drag.sourceCategoryName, event.clientX, event.clientY)
                            : null;
                          if (drag.active) {
                            event.preventDefault();
                            event.stopPropagation();
                          }
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                          }
                          clearCategoryPointerDrag();
                          if (target) void moveDraggedCategory(drag.typeName, drag.sourceCategoryName, target.categoryName, target.position);
                        }}
                        onPointerCancel={(event) => {
                          if (categoryPointerDragRef.current?.pointerId !== event.pointerId) return;
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                          }
                          clearCategoryPointerDrag();
                        }}
                        title="拖动调整分类顺序"
                        aria-label={`拖动调整「${categoryName}」顺序`}
                      ><GripVertical size={12} /></button>
                      <button className="tree-category-main" onClick={() => selectCategory(typeName, categoryName)}>
                        <Folder size={14} />
                        <span>{categoryName}</span>
                        <em>{getCategories(data, typeName)[categoryName].length}</em>
                      </button>
                      <button
                        className={`tree-actions-trigger category-trigger ${categoryActionsOpen ? "open" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTreeActionMenuKey((current) => current === categoryActionsKey ? null : categoryActionsKey);
                        }}
                        title="更多操作"
                        aria-label={`打开「${categoryName}」操作`}
                        aria-expanded={categoryActionsOpen}
                      ><Ellipsis size={14} /></button>
                      <div className={`tree-row-actions category-actions ${categoryActionsOpen ? "open" : ""}`}>
                        <button onClick={() => setEntityDialog({ mode: "rename-category", initial: categoryName, typeName, categoryName })} title="重命名分类"><Pencil size={12} /></button>
                        <button className="danger" onClick={() => deleteCategory(typeName, categoryName)} title="删除分类"><Trash2 size={12} /></button>
                      </div>
                    </div>;
                  })}
                  {!categories.length && <button className="tree-empty-action" onClick={() => setEntityDialog({ mode: "add-category", typeName })}><Plus size={13} />新增第一个分类</button>}
                </div>}
              </div>;
            })}
            {!types.length && <div className="sidebar-empty">还没有类型<br /><button onClick={() => setEntityDialog({ mode: "add-type" })}>创建第一个类型</button></div>}
          </div>
        </section>

        <div className="sidebar-footer">
          <span className={`security-dot ${password ? "secured" : ""}`} />
          <div><strong>{password ? "资料库已加密" : "资料库未加密"}</strong><small title={status.dataPath}>{status.dataPath}</small></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div className="workspace-title">
            <div className="breadcrumb"><span>{activeTab.typeName || "资料库"}</span><ChevronRight size={13} /><span>{activeTab.search ? "全局搜索" : activeTab.categoryName || "未选择分类"}</span></div>
            <h1>{displayTitle}</h1>
            <p>{activeTab.search
              ? `在全部资料中找到 ${visiblePrompts.length} 条结果`
              : activeTab.typeName
                ? `${categoryPrompts.length} 条提示词，可快速复制与整理`
                : "从左侧选择类型和分类后开始浏览"}</p>
          </div>
          <div className="header-tools">
            <div className="search-box">
              <Search size={17} />
              <input ref={searchRef} value={activeTab.search} onChange={(event) => patchTab(activeTab.id, { search: event.target.value })} placeholder="搜索所有标题和内容…" />
              {activeTab.search && <button onClick={() => patchTab(activeTab.id, { search: "" })}><X size={15} /></button>}
              <kbd>Ctrl F</kbd>
            </div>
            <button className="primary-button" disabled={!activeTab.categoryName || Boolean(activeTab.search)} onClick={() => setPromptDialog({ mode: "add" })}><Plus size={17} />添加内容</button>
          </div>
        </header>

        <div className="content-area">
          {visiblePrompts.length ? (
            <div className="prompt-list">
              {visiblePrompts.map((location, displayIndex) => {
                const title = promptTitle(location.prompt);
                const content = promptContent(location.prompt);
                const global = Boolean(activeTab.search.trim());
                const pinned = isPromptPinned(location.prompt);
                const locationPrompts = getCategories(data, location.typeName)[location.categoryName] || [];
                const firstUnpinnedIndex = locationPrompts.findIndex((prompt) => !isPromptPinned(prompt));
                const groupStartIndex = pinned ? 0 : firstUnpinnedIndex < 0 ? locationPrompts.length : firstUnpinnedIndex;
                const sortable = !global && !busy && locationPrompts.filter((prompt) => isPromptPinned(prompt) === pinned).length > 1;
                const promptActionsKey = `prompt:${location.typeName}\u0000${location.categoryName}\u0000${location.index}`;
                const promptActionsOpen = promptActionMenuKey === promptActionsKey;
                const dragging = !global && dragPromptIndex === location.index;
                const dropPosition = !global && promptDropTarget?.index === location.index
                  ? promptDropTarget.position
                  : null;
                return <article
                  className={`prompt-card ${global ? "search-result" : ""} ${pinned ? "pinned" : ""} ${sortable ? "sortable" : ""} ${dragging ? "dragging" : ""} ${dropPosition ? `drop-${dropPosition}` : ""}`}
                  key={`${location.typeName}-${location.categoryName}-${location.index}-${content.slice(0, 24)}`}
                  data-prompt-index={location.index}
                  data-prompt-pinned={pinned}
                  onContextMenu={(event) => { event.preventDefault(); setContextMenu({ ...location, x: event.clientX, y: event.clientY }); }}
                  onMouseEnter={() => setPromptActionMenuKey((current) => (
                    current && current !== promptActionsKey ? null : current
                  ))}
                  onMouseLeave={() => setPromptActionMenuKey((current) => (
                    current === promptActionsKey ? null : current
                  ))}
                >
                  {!global && (
                    <div
                      className="prompt-drag-handle"
                      onPointerDown={(event) => {
                        if (!sortable || !event.isPrimary || event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        promptPointerDragRef.current = {
                          typeName: location.typeName,
                          categoryName: location.categoryName,
                          sourceIndex: location.index,
                          sourcePinned: pinned,
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY,
                          active: false,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        document.documentElement.classList.add("type-pointer-dragging");
                        setPromptDropTarget(null);
                      }}
                      onPointerMove={(event) => {
                        const drag = promptPointerDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        if (!drag.active) {
                          if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
                          drag.active = true;
                          setDragPromptIndex(drag.sourceIndex);
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        const target = resolvePromptDropTarget(drag.sourceIndex, drag.sourcePinned, event.clientX, event.clientY);
                        setPromptDropTarget((current) => (
                          current?.index === target?.index && current?.position === target?.position
                            ? current
                            : target
                        ));
                      }}
                      onPointerUp={(event) => {
                        const drag = promptPointerDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        const target = drag.active
                          ? resolvePromptDropTarget(drag.sourceIndex, drag.sourcePinned, event.clientX, event.clientY)
                          : null;
                        if (drag.active) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        clearPromptPointerDrag();
                        if (target) {
                          void moveDraggedPrompt(
                            drag.typeName,
                            drag.categoryName,
                            drag.sourceIndex,
                            target.index,
                            target.position,
                          );
                        }
                      }}
                      onPointerCancel={(event) => {
                        if (promptPointerDragRef.current?.pointerId !== event.pointerId) return;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        clearPromptPointerDrag();
                      }}
                      title="拖动排序"
                      aria-label={`拖动第 ${displayIndex + 1} 条提示词排序`}
                    >
                      <GripVertical size={14} />
                    </div>
                  )}
                  <button className="copy-button" onClick={() => copyPrompt(location.prompt)}><Copy size={17} /><span>复制</span></button>
                  <div className="prompt-content">
                    {global && <div className="prompt-content-flags">
                      <div className="source-pill">{location.typeName}<ChevronRight size={11} />{location.categoryName}</div>
                    </div>}
                    {title && <h3>{title}</h3>}
                    <p>{content || <span className="muted-copy">（无正文）</span>}</p>
                  </div>
                  <div className="prompt-actions">
                    <div className={`prompt-default-actions ${promptActionsOpen ? "open" : ""}`}>
                      <button onClick={() => setPromptViewer(location)} title="查看完整内容" aria-label="查看完整内容"><Eye size={16} /></button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setPromptActionMenuKey((current) => current === promptActionsKey ? null : promptActionsKey);
                        }}
                        title="更多操作"
                        aria-label="打开更多操作"
                        aria-expanded={promptActionsOpen}
                      ><Ellipsis size={17} /></button>
                    </div>
                    <div className={`prompt-row-actions ${promptActionsOpen ? "open" : ""}`}>
                      <button onClick={() => { setPromptViewer(location); setPromptActionMenuKey(null); }} title="查看完整内容"><Eye size={16} /></button>
                      <button onClick={() => { setPromptDialog({ mode: "edit", location }); setPromptActionMenuKey(null); }} title="编辑"><Pencil size={16} /></button>
                      <button onClick={() => { void movePromptToTop(location); setPromptActionMenuKey(null); }} disabled={location.index === groupStartIndex} title={pinned ? "置顶到 Pin 分组第一位" : "置顶到普通分组第一位"}><ChevronsUp size={16} /></button>
                      <button className={pinned ? "pin-active" : ""} onClick={() => { void togglePromptPin(location); setPromptActionMenuKey(null); }} title={pinned ? "取消 Pin" : "Pin 到顶部"}><Pin size={16} /></button>
                      <button onClick={() => { setMoveLocation(location); setPromptActionMenuKey(null); }} title="移动到"><FolderInput size={16} /></button>
                      <button className="danger" onClick={() => { requestDeletePrompt(location); setPromptActionMenuKey(null); }} title="删除"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </article>;
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div><FileText size={30} /></div>
              <h2>{activeTab.search
                ? "没有找到匹配内容"
                : activeTab.categoryName
                  ? "这个分类还是空的"
                  : types.length ? "请选择一个类型" : "先创建一个类型和分类"}</h2>
              <p>{activeTab.search
                ? "换一个关键词试试，搜索会同时匹配标题与正文。"
                : activeTab.typeName
                  ? "把常用提示词整理进来，之后一键即可复制。"
                  : types.length ? "从左侧选择一个类型，再进入需要的分类。" : "创建资料结构后，就可以开始整理提示词。"}</p>
              {!activeTab.search && activeTab.categoryName && <button className="primary-button" onClick={() => setPromptDialog({ mode: "add" })}><Plus size={17} />添加第一条提示词</button>}
            </div>
          )}
        </div>
      </section>

      {busy && <div className="saving-indicator"><div className="mini-loader" />正在安全保存</div>}
      {toast && <div className={`toast ${toast.kind}`}>{toast.kind === "success" && <Check size={17} />}{toast.kind === "error" && <X size={17} />}{toast.message}</div>}

      {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => { copyPrompt(contextMenu.prompt); setContextMenu(null); }}><Copy size={15} />复制</button>
        <button onClick={() => { setPromptDialog({ mode: "edit", location: contextMenu }); setContextMenu(null); }}><Pencil size={15} />编辑</button>
        <button onClick={() => { void movePromptToTop(contextMenu); setContextMenu(null); }}><ChevronsUp size={15} />置顶</button>
        <button onClick={() => { void togglePromptPin(contextMenu); setContextMenu(null); }}><Pin size={15} />{isPromptPinned(contextMenu.prompt) ? "取消 Pin" : "Pin 到顶部"}</button>
        <button onClick={() => { setMoveLocation(contextMenu); setContextMenu(null); }}><FolderInput size={15} />移动到…</button>
        <div />
        <button className="danger-text" onClick={() => { requestDeletePrompt(contextMenu); setContextMenu(null); }}><Trash2 size={15} />删除</button>
      </div>}

      {entityDialog && <EntityModal dialog={entityDialog} onClose={() => setEntityDialog(null)} onSave={saveEntity} />}
      {promptDialog && <PromptEditor dialog={promptDialog} onClose={() => setPromptDialog(null)} onSave={savePrompt} />}
      {promptViewer && <PromptViewer
        location={promptViewer}
        onClose={() => setPromptViewer(null)}
        onCopy={() => { void copyPrompt(promptViewer.prompt); }}
        onEdit={() => {
          setPromptDialog({ mode: "edit", location: promptViewer });
          setPromptViewer(null);
        }}
      />}
      {confirmation && <ConfirmModal confirmation={confirmation} onClose={() => setConfirmation(null)} />}
      {moveLocation && <MoveModal data={data} source={moveLocation} onClose={() => setMoveLocation(null)} onMove={movePrompt} />}
      {importDraft && <ImportModal onClose={() => setImportDraft(null)} onApply={applyImport} />}
      {securityMode && <SecurityModal mode={securityMode} encrypted={Boolean(password)} onMode={setSecurityMode} onClose={() => setSecurityMode(null)} onApply={applySecurity} />}
      {settingsOpen && <SettingsModal fontSize={fontSize} theme={theme} onFontSize={setFontSize} onTheme={setTheme} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

function EntityModal({ dialog, onClose, onSave }: { dialog: EntityDialog; onClose: () => void; onSave: (value: string) => void }) {
  const [value, setValue] = useState(dialog.initial || "");
  const labels = {
    "add-type": ["新增类型", "给一组相关分类起一个清晰的名字"],
    "rename-type": ["重命名类型", "该类型下的所有内容都会保留"],
    "add-category": ["新增分类", "分类用于进一步整理提示词"],
    "rename-category": ["重命名分类", "分类中的提示词不会改变"],
    "rename-tab": ["重命名标签", "自定义名称只影响当前工作标签"],
  }[dialog.mode];
  return <Modal title={labels[0]} subtitle={labels[1]} onClose={onClose} icon={<Pencil size={18} />}>
    <form onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
      <label className="field-label">名称</label>
      <input className="text-input" autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="请输入名称" />
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!value.trim()}>保存</button></div>
    </form>
  </Modal>;
}

function PromptEditor({ dialog, onClose, onSave }: { dialog: PromptDialog; onClose: () => void; onSave: (title: string, content: string) => void }) {
  const source = dialog.mode === "edit" ? dialog.location?.prompt : undefined;
  const [title, setTitle] = useState(source ? promptTitle(source) : "");
  const [content, setContent] = useState(source ? promptContent(source) : "");
  return <Modal wide title={dialog.mode === "add" ? "添加提示词" : "编辑提示词"} subtitle="标题可选；复制时只会复制正文内容" onClose={onClose} icon={<FileText size={19} />}>
    <form onSubmit={(event) => { event.preventDefault(); onSave(title, content); }}>
      <label className="field-label">标题 <span>可选</span></label>
      <input className="text-input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：电影感人物特写" />
      <label className="field-label field-spaced">提示词内容</label>
      <textarea
        className="text-area"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey && event.key === "Enter") || (event.ctrlKey && event.key.toLowerCase() === "s")) {
            event.preventDefault();
            if (title.trim() || content.trim()) onSave(title, content);
          }
        }}
        placeholder="输入完整提示词…"
      />
      <div className="editor-meta"><span>{content.length} 字符</span><span>Ctrl + Enter 保存</span></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() && !content.trim()}><Check size={16} />保存</button></div>
    </form>
  </Modal>;
}

function PromptViewer({ location, onClose, onCopy, onEdit }: { location: PromptLocation; onClose: () => void; onCopy: () => void; onEdit: () => void }) {
  const title = promptTitle(location.prompt);
  const content = promptContent(location.prompt);
  return <Modal wide title={title || "提示词详情"} subtitle={`${location.typeName} / ${location.categoryName}`} onClose={onClose} icon={<Eye size={19} />}>
    <div className="prompt-viewer-content">{content || <span>（无正文）</span>}</div>
    <div className="editor-meta"><span>{content.length} 字符</span><span>完整内容</span></div>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>关闭</button><button className="secondary-button" onClick={onEdit}><Pencil size={16} />编辑</button><button className="primary-button" onClick={onCopy}><Copy size={16} />复制内容</button></div>
  </Modal>;
}

function ConfirmModal({ confirmation, onClose }: { confirmation: Confirmation; onClose: () => void }) {
  const run = async () => { await confirmation.action(); onClose(); };
  return <Modal title={confirmation.title} subtitle="此操作会立即保存到资料库" onClose={onClose} icon={<Trash2 size={18} />}>
    <p className="confirm-copy">{confirmation.message}</p>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className={confirmation.danger ? "danger-button" : "primary-button"} onClick={run}>{confirmation.confirmLabel || "确认"}</button></div>
  </Modal>;
}

function MoveModal({ data, source, onClose, onMove }: { data: PromptData; source: PromptLocation; onClose: () => void; onMove: (typeName: string, categoryName: string) => void }) {
  const types = getTypes(data);
  const destinationCount = types.reduce((total, typeName) => (
    total + getCategoryNames(data, typeName).filter((categoryName) => (
      typeName !== source.typeName || categoryName !== source.categoryName
    )).length
  ), 0);
  const [expandedTypeName, setExpandedTypeName] = useState("");
  const [selected, setSelected] = useState("");
  const [selectedTypeName, selectedCategoryName] = selected
    ? selected.split("\u0000")
    : ["", ""];

  return <Modal wide title="移动提示词" subtitle={`当前位置：${source.typeName} / ${source.categoryName}`} onClose={onClose} icon={<FolderInput size={18} />}>
    <div className="move-tree-heading"><span>选择目标分类</span><em>{destinationCount} 个可用位置</em></div>
    <div className="move-tree">
      {types.map((typeName) => {
        const categories = getCategoryNames(data, typeName);
        const expanded = expandedTypeName === typeName;
        const containsSelection = selectedTypeName === typeName;
        return <div className={`move-tree-group ${expanded ? "expanded" : ""}`} key={typeName}>
          <button
            className={`move-tree-type ${containsSelection ? "contains-selection" : ""}`}
            onClick={() => setExpandedTypeName((current) => current === typeName ? "" : typeName)}
            aria-expanded={expanded}
          >
            <ChevronRight size={15} />
            <Layers3 size={16} />
            <span>{typeName}</span>
            <em>{categories.length}</em>
          </button>
          {expanded && <div className="move-tree-categories">
            {categories.map((categoryName) => {
              const current = typeName === source.typeName && categoryName === source.categoryName;
              const value = `${typeName}\u0000${categoryName}`;
              const selectedTarget = selected === value;
              const promptCount = getCategories(data, typeName)[categoryName].length;
              return <button
                className={`move-tree-category ${current ? "current" : ""} ${selectedTarget ? "selected" : ""}`}
                key={categoryName}
                disabled={current}
                onClick={() => setSelected(value)}
              >
                <Folder size={15} />
                <span>{categoryName}</span>
                {current ? <small>当前位置</small> : selectedTarget ? <Check size={15} /> : <em>{promptCount}</em>}
              </button>;
            })}
            {!categories.length && <div className="move-tree-empty">该类型下还没有分类</div>}
          </div>}
        </div>;
      })}
      {!types.length && <div className="move-tree-empty move-tree-empty-root">资料库中还没有可用分类</div>}
    </div>

    <div className={`move-target-summary ${selected ? "ready" : ""}`}>
      <div><FolderInput size={17} /></div>
      <span>{selected ? "将移动到" : "尚未选择目标分类"}</span>
      {selected && <strong>{selectedTypeName}<ChevronRight size={13} />{selectedCategoryName}</strong>}
    </div>
    {!destinationCount && <p className="form-error move-tree-error">请先在资料库中创建另一个分类。</p>}
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!selected} onClick={() => onMove(selectedTypeName, selectedCategoryName)}><FolderInput size={16} />确认移动</button></div>
  </Modal>;
}

function ImportModal({ onClose, onApply }: { onClose: () => void; onApply: (mode: "merge" | "replace") => void }) {
  return <Modal title="选择导入方式" subtitle="已成功读取 JSON 文件" onClose={onClose} icon={<Upload size={18} />}>
    <div className="choice-grid">
      <button onClick={() => onApply("merge")}><div><Plus size={20} /></div><strong>合并导入</strong><p>保留现有资料，仅加入不重复的内容。推荐日常使用。</p></button>
      <button className="choice-danger" onClick={() => onApply("replace")}><div><Download size={20} /></div><strong>覆盖导入</strong><p>完全替换当前资料库。现有内容不会保留。</p></button>
    </div>
  </Modal>;
}

function SettingsModal({ fontSize, theme, onFontSize, onTheme, onClose }: { fontSize: number; theme: ThemeMode; onFontSize: (size: number) => void; onTheme: (theme: ThemeMode) => void; onClose: () => void }) {
  return <Modal title="设置" subtitle="调整 PromptHelper 的界面显示方式" onClose={onClose} icon={<Settings size={19} />}>
    <section className="settings-section">
      <header>
        <div><strong>外观主题</strong><p>切换整个工作台、弹窗和登录界面的颜色</p></div>
        <span>{theme === "dark" ? "暗黑" : "白色"}</span>
      </header>
      <div className="theme-options">
        <button className={theme === "dark" ? "active" : ""} onClick={() => onTheme("dark")} aria-pressed={theme === "dark"}>
          <div className="theme-option-icon dark"><Moon size={18} /></div>
          <span><strong>暗黑模式</strong><small>深色背景，适合低光环境</small></span>
          {theme === "dark" && <Check size={16} />}
        </button>
        <button className={theme === "light" ? "active" : ""} onClick={() => onTheme("light")} aria-pressed={theme === "light"}>
          <div className="theme-option-icon light"><Sun size={18} /></div>
          <span><strong>白色模式</strong><small>明亮背景，适合日间使用</small></span>
          {theme === "light" && <Check size={16} />}
        </button>
      </div>
    </section>
    <section className="settings-section">
      <header>
        <div><strong>界面字号</strong><p>同步调整资料树、内容列表和弹窗文字</p></div>
        <span>{fontSize}px</span>
      </header>
      <div className="font-size-control">
        <small>A</small>
        <input
          type="range"
          min="14"
          max="20"
          step="1"
          value={fontSize}
          onChange={(event) => onFontSize(Number(event.target.value))}
          aria-label="界面字号"
        />
        <strong>A</strong>
      </div>
      <div className="font-size-presets">
        {[14, 16, 18, 20].map((size) => <button key={size} className={fontSize === size ? "active" : ""} onClick={() => onFontSize(size)}>{size === 14 ? "紧凑" : size === 16 ? "默认" : size === 18 ? "较大" : "特大"}</button>)}
      </div>
      <div className="font-size-preview"><span>预览</span><p>提示词资料库 · PromptHelper</p></div>
    </section>
    <div className="modal-actions"><button className="secondary-button" onClick={() => { onFontSize(16); onTheme("dark"); }}>恢复默认</button><button className="primary-button" onClick={onClose}>完成</button></div>
  </Modal>;
}

function SecurityModal({ mode, encrypted, onMode, onClose, onApply }: { mode: "manage" | "enable" | "change" | "disable"; encrypted: boolean; onMode: (mode: "manage" | "enable" | "change" | "disable" | null) => void; onClose: () => void; onApply: (mode: "enable" | "change" | "disable", values: { current?: string; next?: string; confirm?: string }) => void }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState("");
  if (mode === "manage") return <Modal title="数据安全" subtitle={encrypted ? "资料库当前使用与 V4 兼容的密码保护" : "资料库当前以明文 JSON 保存"} onClose={onClose} icon={<ShieldCheck size={19} />}>
    <div className="security-status"><div className={encrypted ? "secure" : "plain"}>{encrypted ? <LockKeyhole size={22} /> : <LockOpen size={22} />}</div><div><strong>{encrypted ? "加密保护已开启" : "未启用加密"}</strong><p>{encrypted ? "每次启动时需要密码解锁。" : "建议为包含私密提示词的资料库设置密码。"}</p></div></div>
    <div className="security-actions">{encrypted ? <><button onClick={() => onMode("change")}><KeyRound size={17} />修改密码<ChevronRight size={16} /></button><button className="danger-text" onClick={() => onMode("disable")}><LockOpen size={17} />关闭加密<ChevronRight size={16} /></button></> : <button onClick={() => onMode("enable")}><LockKeyhole size={17} />启用密码保护<ChevronRight size={16} /></button>}</div>
  </Modal>;
  const disabling = mode === "disable";
  return <Modal title={mode === "enable" ? "启用密码保护" : mode === "change" ? "修改资料库密码" : "关闭数据加密"} subtitle={disabling ? "关闭后数据会以明文 JSON 保存" : "密码至少需要 4 个字符，请妥善保管"} onClose={onClose} icon={disabling ? <LockOpen size={19} /> : <KeyRound size={19} />}>
    <form onSubmit={(event) => { event.preventDefault(); onApply(mode, { current, next, confirm }); }}>
      {mode !== "enable" && <><label className="field-label">当前密码</label><input autoFocus className="text-input" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} /></>}
      {!disabling && <><label className={`field-label ${mode !== "enable" ? "field-spaced" : ""}`}>新密码</label><input autoFocus={mode === "enable"} className="text-input" type="password" value={next} onChange={(event) => setNext(event.target.value)} /><label className="field-label field-spaced">确认新密码</label><input className="text-input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className={disabling ? "danger-button" : "primary-button"}>{disabling ? "关闭加密" : "确认保存"}</button></div>
    </form>
  </Modal>;
}

export default App;
