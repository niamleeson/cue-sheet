mod fonts;
mod pdf;

use std::path::PathBuf;
use tauri::Manager;

/// Saves a DOCX as PDF with Microsoft Word (macOS and Windows).
#[tauri::command]
async fn export_pdf(docx: String, pdf: String) -> Result<pdf::PdfResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::export(&PathBuf::from(docx), &PathBuf::from(pdf)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn pdf_support() -> pdf::Support {
    pdf::support()
}

/// Word's own 맑은 고딕, so the preview draws the glyphs Word prints.
#[tauri::command]
async fn word_font(bold: bool) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || fonts::malgun(bold))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

/// Shows a saved file in Finder / Explorer.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

// ---------- saved cue sheets: one JSON file per Sunday / event in the app's data folder ----------

fn docs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("docs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn doc_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let ok = !id.is_empty() && id.len() <= 120 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err(format!("잘못된 큐시트 이름: {id}"));
    }
    Ok(docs_dir(app)?.join(format!("{id}.json")))
}

/// The text of every saved cue sheet.
#[tauri::command]
async fn docs_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = docs_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    out.push(text);
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Saves one cue sheet: written to a temporary file first, so a crash never leaves half a file.
#[tauri::command]
async fn doc_write(app: tauri::AppHandle, id: String, json: String) -> Result<(), String> {
    let path = doc_path(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = path.with_extension(format!("{nanos}.tmp"));
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn doc_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    match std::fs::remove_file(doc_path(&app, &id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
fn docs_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(docs_dir(&app)?.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            export_pdf,
            pdf_support,
            word_font,
            reveal,
            docs_list,
            doc_write,
            doc_delete,
            docs_dir_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
