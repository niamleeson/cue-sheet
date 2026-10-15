mod fonts;
mod pdf;

use std::path::PathBuf;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![export_pdf, pdf_support, word_font, reveal])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
