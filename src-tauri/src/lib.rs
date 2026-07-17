use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE},
    Engine as _,
};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::RwLock,
};
use tauri::{Manager, State};

const ITERATIONS: u32 = 480_000;
const SALT_LENGTH: usize = 32;
const KEY_LENGTH: usize = 32;
const ENCRYPTED_PREFIX: &str = "ENC:";

struct AppState {
    data_path: RwLock<PathBuf>,
    data_path_config: PathBuf,
    workspace_state_path: PathBuf,
    path_configurable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    encrypted: bool,
    exists: bool,
    data_path: String,
    data_directory: String,
    path_configurable: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataPathConfig {
    data_path: String,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTabState {
    id: String,
    type_name: String,
    category_name: String,
    search: String,
    expanded_type_name: Option<String>,
    custom_name: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceState {
    tabs: Vec<WorkspaceTabState>,
    active_tab_id: String,
}

fn load_configured_data_path(config_path: &Path) -> Option<PathBuf> {
    let raw = fs::read_to_string(config_path).ok()?;
    let config: DataPathConfig = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    let path = config.data_path.trim();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn resolve_data_path(config_path: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("PROMPT_HELPER_DATA_FILE") {
        return PathBuf::from(path);
    }

    if let Some(path) = load_configured_data_path(config_path) {
        return path;
    }

    if let Some(path) = std::env::var_os("PROMPT_HELPER_DEFAULT_DATA_FILE") {
        return PathBuf::from(path);
    }

    let executable_path = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("prompts_data.json")));
    if let Some(path) = executable_path.as_ref().filter(|path| path.exists()) {
        return path.clone();
    }

    // During development and local release builds, keep using the V4 data file
    // one directory above `new` so the migration is immediately compatible.
    let legacy_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("prompts_data.json");
    if legacy_path.exists() {
        return legacy_path;
    }

    executable_path.unwrap_or_else(|| PathBuf::from("prompts_data.json"))
}

fn active_data_path(state: &AppState) -> Result<PathBuf, String> {
    state
        .data_path
        .read()
        .map(|path| path.clone())
        .map_err(|_| "资料库路径状态不可用，请重启软件".to_string())
}

fn status_for_path(path: &Path, path_configurable: bool) -> Result<AppStatus, String> {
    let exists = path.exists();
    let encrypted = if exists {
        read_raw(path)?
            .trim_start_matches('\u{feff}')
            .starts_with(ENCRYPTED_PREFIX)
    } else {
        false
    };
    let data_directory = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_string_lossy()
        .into_owned();
    Ok(AppStatus {
        encrypted,
        exists,
        data_path: path.to_string_lossy().into_owned(),
        data_directory,
        path_configurable,
    })
}

fn validate_data_path_for_selection(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let raw = read_raw(path)?;
    let raw = raw.trim_start_matches('\u{feff}');
    if raw.starts_with(ENCRYPTED_PREFIX) || raw.trim().is_empty() {
        return Ok(());
    }
    let value: Value = serde_json::from_str(raw)
        .map_err(|error| format!("所选文件夹内的 prompts_data.json 不是有效 JSON：{error}"))?;
    validate_prompt_data(&value)
}

fn persist_data_path(config_path: &Path, data_path: &Path) -> Result<(), String> {
    let config = DataPathConfig {
        data_path: data_path.to_string_lossy().into_owned(),
    };
    let contents = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("资料库位置配置序列化失败：{error}"))?;
    write_safely(config_path, &contents).map_err(|error| format!("无法保存资料库位置设置：{error}"))
}

fn load_workspace_state_from_path(path: &Path) -> Result<Option<WorkspaceState>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| format!("无法读取工作区状态：{error}"))?;
    let raw = raw.trim_start_matches('\u{feff}').trim();
    if raw.is_empty() {
        return Ok(None);
    }

    serde_json::from_str(raw)
        .map(Some)
        .map_err(|error| format!("工作区状态格式无效：{error}"))
}

fn persist_workspace_state(path: &Path, workspace_state: &WorkspaceState) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(workspace_state)
        .map_err(|error| format!("工作区状态序列化失败：{error}"))?;
    write_safely(path, &contents).map_err(|error| format!("无法保存工作区状态：{error}"))
}

fn read_raw(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("无法读取数据文件：{error}"))
}

fn validate_prompt_data(data: &Value) -> Result<(), String> {
    if !data.is_object() {
        return Err("数据格式错误：顶级对象必须是 JSON 对象".into());
    }
    Ok(())
}

fn derive_legacy_key(password: &str, salt: &[u8]) -> Vec<u8> {
    let mut key = [0_u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, ITERATIONS, &mut key);
    URL_SAFE.encode(key).into_bytes()
}

fn decrypt_legacy(payload: &str, password: &str) -> Result<Value, String> {
    let decoded = STANDARD
        .decode(payload.trim())
        .map_err(|_| "加密数据格式无效".to_string())?;
    if decoded.len() < 4 + SALT_LENGTH {
        return Err("加密数据不完整".into());
    }

    let salt = &decoded[4..4 + SALT_LENGTH];
    let encrypted = &decoded[4 + SALT_LENGTH..];
    let key = derive_legacy_key(password, salt);
    let key_stream: Vec<u8> = key.iter().chain(salt.iter()).copied().collect();
    let decrypted: Vec<u8> = encrypted
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ key_stream[index % key_stream.len()])
        .collect();
    let json = String::from_utf8(decrypted).map_err(|_| "密码错误或数据文件已损坏".to_string())?;
    let value: Value =
        serde_json::from_str(&json).map_err(|_| "密码错误或数据文件已损坏".to_string())?;
    validate_prompt_data(&value)?;
    Ok(value)
}

fn encrypt_legacy(data: &Value, password: &str) -> Result<String, String> {
    let json =
        serde_json::to_string_pretty(data).map_err(|error| format!("数据序列化失败：{error}"))?;
    let mut salt = [0_u8; SALT_LENGTH];
    getrandom::fill(&mut salt).map_err(|error| format!("生成加密盐失败：{error}"))?;
    let key = derive_legacy_key(password, &salt);
    let key_stream: Vec<u8> = key.iter().chain(salt.iter()).copied().collect();
    let encrypted: Vec<u8> = json
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ key_stream[index % key_stream.len()])
        .collect();

    let mut packed = Vec::with_capacity(4 + SALT_LENGTH + encrypted.len());
    packed.extend_from_slice(&salt[..4]);
    packed.extend_from_slice(&salt);
    packed.extend_from_slice(&encrypted);
    Ok(format!("{ENCRYPTED_PREFIX}{}", STANDARD.encode(packed)))
}

fn write_safely(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建数据目录：{error}"))?;
    }

    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file =
        fs::File::create(&temporary).map_err(|error| format!("无法创建临时数据文件：{error}"))?;
    file.write_all(contents.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("无法写入数据：{error}"))?;

    if backup.exists() {
        fs::remove_file(&backup).map_err(|error| format!("无法清理旧备份：{error}"))?;
    }
    if path.exists() {
        fs::rename(path, &backup).map_err(|error| format!("无法备份原数据：{error}"))?;
    }

    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("无法替换数据文件：{error}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

#[tauri::command]
fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let path = active_data_path(&state)?;
    status_for_path(&path, state.path_configurable)
}

#[tauri::command]
fn set_data_directory(directory: String, state: State<'_, AppState>) -> Result<AppStatus, String> {
    if !state.path_configurable {
        return Err("资料库位置由环境变量 PROMPT_HELPER_DATA_FILE 管理，无法在软件内更改".into());
    }

    let directory = PathBuf::from(directory);
    if !directory.is_dir() {
        return Err("所选资料库文件夹不存在或不可用".into());
    }
    let data_path = directory.join("prompts_data.json");
    validate_data_path_for_selection(&data_path)?;
    let status = status_for_path(&data_path, true)?;
    persist_data_path(&state.data_path_config, &data_path)?;
    *state
        .data_path
        .write()
        .map_err(|_| "资料库路径状态不可用，请重启软件".to_string())? = data_path;
    Ok(status)
}

#[tauri::command]
fn load_data(password: Option<String>, state: State<'_, AppState>) -> Result<Value, String> {
    let data_path = active_data_path(&state)?;
    if !data_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = read_raw(&data_path)?;
    let raw = raw.trim_start_matches('\u{feff}');
    if let Some(payload) = raw.strip_prefix(ENCRYPTED_PREFIX) {
        let password = password
            .filter(|value| !value.is_empty())
            .ok_or("请输入数据密码")?;
        decrypt_legacy(payload, &password)
    } else if raw.trim().is_empty() {
        Ok(serde_json::json!({}))
    } else {
        let value: Value =
            serde_json::from_str(raw).map_err(|error| format!("数据文件不是有效 JSON：{error}"))?;
        validate_prompt_data(&value)?;
        Ok(value)
    }
}

#[tauri::command]
fn save_data(
    data: Value,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let data_path = active_data_path(&state)?;
    validate_prompt_data(&data)?;
    let contents = match password.filter(|value| !value.is_empty()) {
        Some(password) => encrypt_legacy(&data, &password)?,
        None => serde_json::to_string_pretty(&data)
            .map_err(|error| format!("数据序列化失败：{error}"))?,
    };
    write_safely(&data_path, &contents)
}

#[tauri::command]
fn load_workspace_state(state: State<'_, AppState>) -> Result<Option<WorkspaceState>, String> {
    load_workspace_state_from_path(&state.workspace_state_path)
}

#[tauri::command]
fn save_workspace_state(
    workspace_state: WorkspaceState,
    state: State<'_, AppState>,
) -> Result<(), String> {
    persist_workspace_state(&state.workspace_state_path, &workspace_state)
}

#[tauri::command]
fn import_plaintext_file(path: String) -> Result<Value, String> {
    let raw = fs::read_to_string(&path).map_err(|error| format!("导入文件读取失败：{error}"))?;
    if raw
        .trim_start_matches('\u{feff}')
        .starts_with(ENCRYPTED_PREFIX)
    {
        return Err("导入文件必须是明文 JSON；加密数据请作为主数据文件打开".into());
    }
    let value: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("导入文件不是有效 JSON：{error}"))?;
    validate_prompt_data(&value)?;
    Ok(value)
}

#[tauri::command]
fn export_plaintext_file(path: String, data: Value) -> Result<(), String> {
    validate_prompt_data(&data)?;
    let contents = serde_json::to_string_pretty(&data)
        .map_err(|error| format!("导出数据序列化失败：{error}"))?;
    write_safely(Path::new(&path), &contents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_config_dir = app.path().app_config_dir().unwrap_or_else(|_| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(Path::to_path_buf))
                    .unwrap_or_else(|| PathBuf::from("."))
            });
            let data_path_config = app_config_dir.join("database-location.json");
            let workspace_state_path = app_config_dir.join("workspace-state.json");
            let path_configurable = std::env::var_os("PROMPT_HELPER_DATA_FILE").is_none();
            app.manage(AppState {
                data_path: RwLock::new(resolve_data_path(&data_path_config)),
                data_path_config,
                workspace_state_path,
                path_configurable,
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            set_data_directory,
            load_data,
            save_data,
            load_workspace_state,
            save_workspace_state,
            import_plaintext_file,
            export_plaintext_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn decrypts_python_v4_compatible_fixture() {
        let payload = "AAECAwABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fSkhEVUsHGggyPBJYQQAJR0t8UHZOckZHTU4ECjIiMU1NRFAFZlBXT3gfOFxnZCA5JH4MJygpKil8aGF/fHQwKTROHDc4OTo7PGYUPxFiRFVJeE5TNjA5W1ZGVhVLMhVeMHBKbU1MTUdzZXRPZQcfNj4/GRt4THUfcG5wd3Zkb3MoeXhkYX16LRoxMjM0NTZqEjk6OzxAFD8RP24I";
        let decrypted = decrypt_legacy(payload, "compat-test").expect("fixture should decrypt");
        assert_eq!(decrypted["image"]["people"][0]["title"], "test");
        assert_eq!(
            decrypted["image"]["people"][0]["content"],
            "portrait prompt"
        );
    }

    #[test]
    fn encrypted_round_trip_preserves_unicode_data() {
        let original = serde_json::json!({
            "_type_order": ["图像"],
            "图像": {"人物": [{"title": "电影感", "content": "自然光人物特写"}]}
        });
        let encrypted = encrypt_legacy(&original, "correct horse").expect("encrypt");
        let decrypted = decrypt_legacy(
            encrypted.strip_prefix(ENCRYPTED_PREFIX).expect("prefix"),
            "correct horse",
        )
        .expect("decrypt");
        assert_eq!(decrypted, original);
    }

    #[test]
    fn wrong_password_is_rejected() {
        let original = serde_json::json!({"image": {"general": ["test"]}});
        let encrypted = encrypt_legacy(&original, "right-password").expect("encrypt");
        assert!(decrypt_legacy(
            encrypted.strip_prefix(ENCRYPTED_PREFIX).expect("prefix"),
            "wrong-password"
        )
        .is_err());
    }

    #[test]
    fn persisted_data_path_round_trip_preserves_unicode_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let config_path = std::env::temp_dir().join(format!(
            "prompt-helper-database-location-{}-{unique}.json",
            std::process::id()
        ));
        let selected_path = PathBuf::from(r"D:\资料库\prompts_data.json");

        persist_data_path(&config_path, &selected_path).expect("persist data path");
        assert_eq!(load_configured_data_path(&config_path), Some(selected_path));

        fs::remove_file(config_path).expect("remove test config");
    }

    #[test]
    fn invalid_plaintext_database_is_rejected_before_selection() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let data_path = std::env::temp_dir().join(format!(
            "prompt-helper-invalid-data-{}-{unique}.json",
            std::process::id()
        ));
        fs::write(&data_path, "not-json").expect("write invalid database");

        assert!(validate_data_path_for_selection(&data_path).is_err());

        fs::remove_file(data_path).expect("remove invalid database");
    }

    #[test]
    fn workspace_state_round_trip_preserves_tabs_and_active_selection() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let state_path = std::env::temp_dir().join(format!(
            "prompt-helper-workspace-state-{}-{unique}.json",
            std::process::id()
        ));
        let expected = WorkspaceState {
            tabs: vec![
                WorkspaceTabState {
                    id: "tab-one".into(),
                    type_name: "图像".into(),
                    category_name: "人物".into(),
                    search: String::new(),
                    expanded_type_name: Some("图像".into()),
                    custom_name: Some("常用人物".into()),
                },
                WorkspaceTabState {
                    id: "tab-two".into(),
                    type_name: "视频".into(),
                    category_name: "分镜".into(),
                    search: "夜景".into(),
                    expanded_type_name: Some("视频".into()),
                    custom_name: None,
                },
            ],
            active_tab_id: "tab-two".into(),
        };

        persist_workspace_state(&state_path, &expected).expect("persist workspace state");
        assert_eq!(
            load_workspace_state_from_path(&state_path).expect("load workspace state"),
            Some(expected)
        );

        fs::remove_file(state_path).expect("remove workspace state");
    }
}
