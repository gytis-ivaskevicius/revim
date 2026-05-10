use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::fs::File;
use std::io::Write;
use std::mem::ManuallyDrop;
use std::os::unix::io::FromRawFd;
use std::sync::Mutex;
static LOG_FILE: Mutex<Option<ManuallyDrop<File>>> = Mutex::new(None);

fn format_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[napi]
pub fn set_log_fd(fd: i32) -> Result<()> {
    if fd < 0 {
        return Err(Error::from_reason("Invalid fd"));
    }
    let file = unsafe { ManuallyDrop::new(File::from_raw_fd(fd as std::os::unix::io::RawFd)) };
    let mut guard = LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(file);
    Ok(())
}

#[napi]
#[allow(dead_code)]
pub fn clear_log_fd() {
    let mut guard = LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
    guard.take();
}

pub(crate) fn is_logging_enabled() -> bool {
    let guard = LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
    guard.is_some()
}

pub(crate) fn append_log(msg: &str) {
    let msg = msg.replace('\n', "\\n");
    let line = format!("[{}] [RS] {}\n", format_timestamp(), msg);
    let mut guard = LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref mut file) = *guard {
        let _ = file.write_all(line.as_bytes());
    }
}

macro_rules! revim_log {
    ($($arg:tt)*) => {
        if $crate::tui::log::is_logging_enabled() {
            $crate::tui::log::append_log(&format!($($arg)*))
        }
    };
}

pub(crate) use revim_log;

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs::OpenOptions;
    use std::io::Read;
    use std::os::unix::io::IntoRawFd;

    fn cleanup_log() {
        let mut guard = LOG_FILE.lock().unwrap_or_else(|e| e.into_inner());
        guard.take();
    }

    #[test]
    #[serial]
    fn test_append_log_without_set_log_fd() {
        cleanup_log();
        append_log("hello");
    }

    #[test]
    #[serial]
    fn test_set_log_fd_invalid_fd() {
        cleanup_log();

        let result = set_log_fd(-1);
        assert!(result.is_err());

        append_log("hello after invalid fd");
    }

    #[test]
    #[serial]
    fn test_set_log_fd_and_append() {
        cleanup_log();

        let temp_dir = std::env::temp_dir();
        let unique_id = std::process::id();
        let thread_id = std::thread::current().id();
        let temp_path = temp_dir.join(format!("revim_test_{}_{:?}.log", unique_id, thread_id));
        let path_str = temp_path.to_str().unwrap();

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path_str)
            .unwrap();
        let fd = file.into_raw_fd();

        let result = set_log_fd(fd);
        assert!(result.is_ok());

        append_log("hello");

        let mut contents = String::new();
        OpenOptions::new()
            .read(true)
            .open(path_str)
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();

        cleanup_log();

        let re =
            regex::Regex::new(r"^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] \[RS\] hello\n$")
                .unwrap();
        assert!(
            re.is_match(&contents),
            "Line did not match regex: {:?}",
            contents
        );

        std::fs::remove_file(path_str).ok();
    }

    #[test]
    #[serial]
    fn test_is_logging_enabled() {
        cleanup_log();

        // No fd set, should be false
        assert!(!is_logging_enabled());

        // Set a valid fd, should be true
        let temp_dir = std::env::temp_dir();
        let unique_id = std::process::id();
        let thread_id = std::thread::current().id();
        let temp_path = temp_dir.join(format!("revim_test_enabled_{}_{:?}.log", unique_id, thread_id));
        let path_str = temp_path.to_str().unwrap();

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path_str)
            .unwrap();
        let fd = file.into_raw_fd();

        let result = set_log_fd(fd);
        assert!(result.is_ok());
        assert!(is_logging_enabled());

        cleanup_log();
        assert!(!is_logging_enabled());

        std::fs::remove_file(path_str).ok();
    }

    #[test]
    fn test_format_timestamp_format() {
        let ts = format_timestamp();
        let re = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$").unwrap();
        assert!(
            re.is_match(&ts),
            "Timestamp did not match expected format: {:?}",
            ts
        );
    }
}
