//! Word's copy of 맑은 고딕 (Malgun Gothic), the cue sheet templates' font, for the preview.
//! Only these two font files are ever read.

use std::path::PathBuf;

const REGULAR: &str = "malgun.ttf";
const BOLD: &str = "malgunbd.ttf";

fn dirs() -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut out = Vec::new();
    #[cfg(target_os = "macos")]
    {
        const IN_WORD: &str = "Microsoft Word.app/Contents/Resources/DFonts";
        out.push(PathBuf::from("/Applications").join(IN_WORD));
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home).join("Applications").join(IN_WORD));
        }
    }
    #[cfg(windows)]
    if let Some(windir) = std::env::var_os("WINDIR") {
        out.push(PathBuf::from(windir).join("Fonts"));
    }
    out
}

fn is_font(b: &[u8]) -> bool {
    b.starts_with(&[0, 1, 0, 0]) || b.starts_with(b"true") || b.starts_with(b"OTTO")
}

/// The regular or bold font file's bytes.
pub fn malgun(bold: bool) -> Result<Vec<u8>, String> {
    let name = if bold { BOLD } else { REGULAR };
    dirs()
        .into_iter()
        .filter_map(|d| std::fs::read(d.join(name)).ok())
        .find(|b| is_font(b))
        .ok_or_else(|| format!("맑은 고딕({name})을 찾을 수 없습니다"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_words_malgun_when_word_is_installed() {
        if dirs().iter().any(|d| d.join(REGULAR).exists()) {
            for bold in [false, true] {
                let b = malgun(bold).expect("font");
                assert!(b.len() > 100_000 && is_font(&b));
            }
        }
    }
}
