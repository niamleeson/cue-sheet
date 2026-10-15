//! PDF export with Microsoft Word's own "Save as PDF", so the PDF is exactly what Word prints.
//! macOS drives Word with AppleScript; Windows drives it over COM from PowerShell.

use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

#[derive(Serialize)]
pub struct Support {
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Serialize)]
pub struct PdfResult {
    /// pages in the PDF Word wrote (None if they could not be counted)
    pub pages: Option<u32>,
}

/// Word handles one document at a time.
static WORD: Mutex<()> = Mutex::new(());

pub fn support() -> Support {
    imp::support()
}

pub fn export(docx: &Path, pdf: &Path) -> Result<PdfResult, String> {
    let _guard = WORD.lock().unwrap_or_else(|e| e.into_inner());
    if !docx.is_file() {
        return Err(format!("DOCX 파일이 없습니다: {}", docx.display()));
    }
    if let Some(dir) = pdf.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("폴더를 만들 수 없습니다 ({}): {e}", dir.display()))?;
    }
    imp::export(docx, pdf)?;
    let bytes = std::fs::read(pdf).map_err(|e| format!("Word가 PDF를 만들지 못했습니다: {e}"))?;
    Ok(PdfResult { pages: count_pages(&bytes) })
}

/// Counts page objects (`/Type /Page`, not `/Pages`). Word writes them uncompressed.
pub fn count_pages(pdf: &[u8]) -> Option<u32> {
    let mut n = 0;
    let mut i = 0;
    while let Some(off) = find(&pdf[i..], b"/Type") {
        let mut j = i + off + 5;
        while j < pdf.len() && pdf[j].is_ascii_whitespace() {
            j += 1;
        }
        if pdf[j..].starts_with(b"/Page") && !pdf.get(j + 5).is_some_and(|c| c.is_ascii_alphanumeric()) {
            n += 1;
        }
        i = j;
    }
    (n > 0).then_some(n)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(target_os = "macos")]
mod imp {
    use super::Support;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    const SCRIPT: &str = include_str!("../scripts/word-pdf.applescript");

    fn home() -> Option<PathBuf> {
        std::env::var_os("HOME").map(PathBuf::from)
    }

    fn word_installed() -> bool {
        let user = home().map(|h| h.join("Applications/Microsoft Word.app"));
        Path::new("/Applications/Microsoft Word.app").exists() || user.is_some_and(|p| p.exists())
    }

    pub fn support() -> Support {
        if word_installed() {
            Support { available: true, reason: None }
        } else {
            Support { available: false, reason: Some("Microsoft Word가 설치되어 있지 않습니다".into()) }
        }
    }

    pub fn export(docx: &Path, pdf: &Path) -> Result<(), String> {
        if !word_installed() {
            return Err("Microsoft Word가 설치되어 있지 않습니다".into());
        }
        // Word is sandboxed: working inside its own container means it never asks for file access
        let container = home().ok_or("홈 폴더를 찾을 수 없습니다")?.join("Library/Containers/com.microsoft.Word");
        if !container.is_dir() {
            return Err("Microsoft Word를 한 번 실행한 뒤 다시 시도하세요".into());
        }
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let stage = container.join(format!("Data/tmp/cuesheet-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&stage).map_err(|e| container_err("임시 폴더를 만들 수 없습니다", e))?;
        let result = run(&stage, docx, pdf);
        let _ = fs::remove_dir_all(&stage);
        result
    }

    fn run(stage: &Path, docx: &Path, pdf: &Path) -> Result<(), String> {
        let (input, output, script) = (stage.join("in.docx"), stage.join("out.pdf"), stage.join("word-pdf.applescript"));
        fs::copy(docx, &input).map_err(|e| container_err("DOCX를 복사할 수 없습니다", e))?;
        fs::write(&script, SCRIPT).map_err(|e| container_err("임시 파일을 만들 수 없습니다", e))?;
        let out = Command::new("/usr/bin/osascript")
            .arg(&script)
            .arg(&input)
            .arg(&output)
            .output()
            .map_err(|e| format!("osascript를 실행할 수 없습니다: {e}"))?;
        if !out.status.success() {
            return Err(explain(&String::from_utf8_lossy(&out.stderr)));
        }
        if !output.is_file() {
            return Err("Word가 PDF를 만들지 못했습니다".into());
        }
        fs::copy(&output, pdf).map_err(|e| format!("PDF를 저장할 수 없습니다 ({}): {e}", pdf.display()))?;
        Ok(())
    }

    /// macOS 14+ asks before an app touches another app's container; a refusal comes back as EPERM.
    fn container_err(what: &str, e: std::io::Error) -> String {
        if e.raw_os_error() == Some(1) {
            format!("{what}: macOS가 Word 폴더 접근을 막았습니다. “다른 앱의 데이터에 접근” 창이 나오면 허용을 누르세요. 창이 다시 나오지 않으면 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에서 '큐시트 메이커'를 켜 주세요.")
        } else {
            format!("{what}: {e}")
        }
    }

    fn explain(stderr: &str) -> String {
        if stderr.contains("-1743") {
            "Word를 제어할 권한이 없습니다. 시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 '큐시트 메이커' 아래 'Microsoft Word'를 켜 주세요.".into()
        } else if stderr.contains("-1712") {
            "Word가 응답하지 않습니다 (시간 초과). Word에 열린 대화상자가 있는지 확인하세요.".into()
        } else {
            format!("Word PDF 저장 실패: {}", stderr.trim())
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::Support;
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // Paths come in through environment variables, so no quoting is needed.
    // Word is closed again only if it has no other documents open.
    const SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($env:CUESHEET_DOCX, $false, $true, $false)
  try { $doc.ExportAsFixedFormat($env:CUESHEET_PDF, 17) } finally { $doc.Close(0) }
} finally {
  if ($word.Documents.Count -eq 0) { $word.Quit() }
}"#;

    pub fn support() -> Support {
        let ok = Command::new("reg")
            .args(["query", r"HKCR\Word.Application\CLSID"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            Support { available: true, reason: None }
        } else {
            Support { available: false, reason: Some("Microsoft Word가 설치되어 있지 않습니다".into()) }
        }
    }

    pub fn export(docx: &Path, pdf: &Path) -> Result<(), String> {
        let out = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &super::encoded_command(SCRIPT)])
            .env("CUESHEET_DOCX", docx)
            .env("CUESHEET_PDF", pdf)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("PowerShell을 실행할 수 없습니다: {e}"))?;
        if !out.status.success() {
            return Err(format!("Word PDF 저장 실패: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    use super::Support;
    use std::path::Path;

    const NO_WORD: &str = "PDF는 Microsoft Word가 있는 Windows 또는 Mac에서 만들 수 있습니다";

    pub fn support() -> Support {
        Support { available: false, reason: Some(NO_WORD.into()) }
    }

    pub fn export(_docx: &Path, _pdf: &Path) -> Result<(), String> {
        Err(NO_WORD.into())
    }
}

/// PowerShell `-EncodedCommand`: base64 of the UTF-16LE script.
#[cfg_attr(not(windows), allow(dead_code))]
fn encoded_command(script: &str) -> String {
    const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for k in 0..4 {
            if k <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * k)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_page_objects_not_the_page_tree() {
        let pdf = b"1 0 obj <</Type /Pages /Count 2>> 2 0 obj <</Type/Page /Parent 1 0 R>> 3 0 obj <</Type /Page>>";
        assert_eq!(count_pages(pdf), Some(2));
        assert_eq!(count_pages(b"no pages here"), None);
    }

    #[test]
    fn encodes_powershell_commands() {
        // "ab" in UTF-16LE is 61 00 62 00
        assert_eq!(encoded_command("ab"), "YQBiAA==");
        assert_eq!(encoded_command("a"), "YQA=");
        assert_eq!(encoded_command("abc"), "YQBiAGMA");
    }

    /// Runs the real Word export on a bundled template: `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn exports_with_word() {
        let dir = std::env::temp_dir().join(format!("cuesheet-pdf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let docx = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/templates/service4.docx");
        let pdf = dir.join("P130 큐시트.pdf");
        let res = export(&docx, &pdf).expect("export");
        assert_eq!(res.pages, Some(1));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
