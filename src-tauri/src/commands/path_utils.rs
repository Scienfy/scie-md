use std::path::{Path, PathBuf};

pub fn external_safe_path(path: &Path) -> PathBuf {
    strip_windows_verbatim_prefix(path)
}

pub fn external_safe_path_string(path: &Path) -> String {
    external_safe_path(path).to_string_lossy().to_string()
}

#[cfg(windows)]
fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::external_safe_path_string;
    use std::path::Path;

    #[test]
    #[cfg(windows)]
    fn strips_windows_verbatim_disk_prefix() {
        assert_eq!(
            external_safe_path_string(Path::new(r"\\?\C:\Users\amin_\paper.md")),
            r"C:\Users\amin_\paper.md"
        );
    }

    #[test]
    #[cfg(windows)]
    fn strips_windows_verbatim_unc_prefix() {
        assert_eq!(
            external_safe_path_string(Path::new(r"\\?\UNC\server\share\paper.md")),
            r"\\server\share\paper.md"
        );
    }
}
