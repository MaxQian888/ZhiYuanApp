use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleInstancePayload {
    pub request_id: u64,
    pub args: Vec<String>,
    pub cwd: String,
}

#[derive(Default)]
pub struct PendingSingleInstanceLaunches(Mutex<Vec<SingleInstancePayload>>);

impl PendingSingleInstanceLaunches {
    pub fn push(&self, payload: SingleInstancePayload) {
        if let Ok(mut pending) = self.0.lock() {
            pending.push(payload);
        }
    }

    fn take(&self) -> Vec<SingleInstancePayload> {
        self.0
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }

    fn acknowledge(&self, request_id: u64) {
        if let Ok(mut pending) = self.0.lock() {
            pending.retain(|payload| payload.request_id != request_id);
        }
    }
}

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

#[tauri::command]
pub fn take_pending_single_instance_launches(
    state: tauri::State<'_, PendingSingleInstanceLaunches>,
) -> Vec<SingleInstancePayload> {
    state.take()
}

#[tauri::command]
pub fn acknowledge_single_instance_launch(
    request_id: u64,
    state: tauri::State<'_, PendingSingleInstanceLaunches>,
) {
    state.acknowledge(request_id);
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

    #[test]
    fn pending_single_instance_launches_are_drained_once() {
        let pending = PendingSingleInstanceLaunches::default();
        pending.push(SingleInstancePayload {
            request_id: 1,
            args: vec!["--route=/orders".into()],
            cwd: "/tmp".into(),
        });

        let first = pending.take();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].request_id, 1);
        assert!(pending.take().is_empty());
    }

    #[test]
    fn acknowledged_single_instance_launch_is_not_replayed() {
        let pending = PendingSingleInstanceLaunches::default();
        pending.push(SingleInstancePayload {
            request_id: 9,
            args: vec![],
            cwd: "/tmp".into(),
        });

        pending.acknowledge(9);

        assert!(pending.take().is_empty());
    }
}
