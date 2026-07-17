import { invoke } from "@tauri-apps/api/core";
import type { AppStatus, PromptData, WorkspaceState } from "../types";

export const api = {
  status: () => invoke<AppStatus>("get_app_status"),
  setDataDirectory: (directory: string) =>
    invoke<AppStatus>("set_data_directory", { directory }),
  load: (password?: string | null) =>
    invoke<PromptData>("load_data", { password: password || null }),
  loadWorkspaceState: () =>
    invoke<WorkspaceState | null>("load_workspace_state"),
  saveWorkspaceState: (workspaceState: WorkspaceState) =>
    invoke<void>("save_workspace_state", { workspaceState }),
  save: (data: PromptData, password?: string | null) =>
    invoke<void>("save_data", { data, password: password || null }),
  importPlaintext: (path: string) =>
    invoke<PromptData>("import_plaintext_file", { path }),
  exportPlaintext: (path: string, data: PromptData) =>
    invoke<void>("export_plaintext_file", { path, data }),
};
