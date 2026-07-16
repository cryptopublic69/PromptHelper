use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE},
    Engine as _,
};
use pbkdf2::pbkdf2_hmac;
use serde::Serialize;
use serde_json::Value;
use sha2::Sha256;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::State;

const ITERATIONS: u32 = 480_000;
const SALT_LENGTH: usize = 32;
const KEY_LENGTH: usize = 32;
const ENCRYPTED_PREFIX: &str = "ENC:";

struct AppState {
    data_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    encrypted: bool,
    exists: bool,
    data_path: String,
}

fn resolve_data_path() -> PathBuf {
    if let Some(path) = std::env::var_os("PROMPT_HELPER_DATA_FILE") {
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
    let exists = state.data_path.exists();
    let encrypted = if exists {
        read_raw(&state.data_path)?
            .trim_start_matches('\u{feff}')
            .starts_with(ENCRYPTED_PREFIX)
    } else {
        false
    };
    Ok(AppStatus {
        encrypted,
        exists,
        data_path: state.data_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn load_data(password: Option<String>, state: State<'_, AppState>) -> Result<Value, String> {
    if !state.data_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let raw = read_raw(&state.data_path)?;
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
    validate_prompt_data(&data)?;
    let contents = match password.filter(|value| !value.is_empty()) {
        Some(password) => encrypt_legacy(&data, &password)?,
        None => serde_json::to_string_pretty(&data)
            .map_err(|error| format!("数据序列化失败：{error}"))?,
    };
    write_safely(&state.data_path, &contents)
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
        .manage(AppState {
            data_path: resolve_data_path(),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            load_data,
            save_data,
            import_plaintext_file,
            export_plaintext_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
