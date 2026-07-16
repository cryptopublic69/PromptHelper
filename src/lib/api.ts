import { invoke } from "@tauri-apps/api/core";
import type { AppStatus, PromptData } from "../types";

export const api = {
  status: () => invoke<AppStatus>("get_app_status"),
  load: (password?: string | null) =>
    invoke<PromptData>("load_data", { password: password || null }),
  save: (data: PromptData, password?: string | null) =>
    invoke<void>("save_data", { data, password: password || null }),
  importPlaintext: (path: string) =>
    invoke<PromptData>("import_plaintext_file", { path }),
  exportPlaintext: (path: string, data: PromptData) =>
    invoke<void>("export_plaintext_file", { path, data }),
};
