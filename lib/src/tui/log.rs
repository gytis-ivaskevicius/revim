use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::fs::File;
use std::io::Write;
use std::mem::ManuallyDrop;
use std::os::unix::io::FromRawFd;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_FILE: Mutex<Option<ManuallyDrop<File>>> = Mutex::new(None);

fn format_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days_since_epoch = secs / 86400;
    let secs_of_day = secs % 86400;
    let hours = secs_of_day / 3600;
    let minutes = (secs_of_day % 3600) / 60;
    let seconds = secs_of_day % 60;
    let mut year = 1970;
    let mut remaining_days = days_since_epoch as i64;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }
    let days_in_months: [i64; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1;
    for days in days_in_months.iter() {
        if remaining_days < *days {
            break;
        }
        remaining_days -= *days;
        month += 1;
    }
    let day = remaining_days + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
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

pub(crate) fn append_log(msg: &str) {
    let msg = msg.replace('\n', "\\n");
    let line = format!("[{}] [RS] {}\n", format_timestamp(), msg);
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(ref mut file) = *guard {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

macro_rules! revim_log {
    ($($arg:tt)*) => { $crate::tui::log::append_log(&format!($($arg)*)) };
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
        if let Ok(mut guard) = LOG_FILE.lock() {
            guard.take();
        }
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
}
