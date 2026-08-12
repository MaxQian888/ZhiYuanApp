use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    platform: &'static str,
    architecture: &'static str,
    app_version: &'static str,
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        app_version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_info_reports_build_and_target() {
        let info = platform_info();
        assert_eq!(info.platform, std::env::consts::OS);
        assert_eq!(info.architecture, std::env::consts::ARCH);
        assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
    }
}
