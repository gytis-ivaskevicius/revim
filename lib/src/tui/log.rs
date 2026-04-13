use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::fs::File;
use std::io::Write;
use std::mem::ManuallyDrop;
use std::os::unix::io::{AsRawFd, FromRawFd};
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
    // First close any previously set file (TS-owned fd that was passed to us)
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(old_file) = guard.take() {
            // Convert back to raw fd and close it
            let raw_fd = std::mem::ManuallyDrop::into_inner(old_file).as_raw_fd();
            // Safety: we owned this fd from a previous set_log_fd call, now we close it
            unsafe {
                libc::close(raw_fd);
            }
        }
        if fd < 0 {
            return Err(Error::from_reason("Invalid fd"));
        }
        let file = unsafe { ManuallyDrop::new(File::from_raw_fd(fd as std::os::unix::io::RawFd)) };
        *guard = Some(file);
    }
    Ok(())
}

pub(crate) fn append_log(msg: &str) {
    let msg = msg.replace('\n', "\\n");
    let line = format!("[{}] [RS] {}\n", format_timestamp(), msg);
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(ref mut file) = *guard {
            let _ = file.write_all(line.as_bytes());
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
    use std::fs::OpenOptions;
    use std::io::Read;
    use std::os::unix::io::IntoRawFd;
    use std::sync::Once;

    static TEST_SETUP: Once = Once::new();

    fn setup_log_for_test() {
        TEST_SETUP.call_once(|| {
            // Ensure LOG_FILE is clean at start of first test
            if let Ok(mut guard) = LOG_FILE.lock() {
                guard.take();
            }
        });
    }

    fn cleanup_log() {
        if let Ok(mut guard) = LOG_FILE.lock() {
            if let Some(old_file) = guard.take() {
                let raw_fd = std::mem::ManuallyDrop::into_inner(old_file).as_raw_fd();
                unsafe { libc::close(raw_fd) };
            }
        }
    }

    #[test]
    fn test_append_log_without_set_log_fd() {
        setup_log_for_test();
        // LOG_FILE should be None, so this should not panic and not write
        append_log("hello");
        // No assertion on file content since nothing should be written
    }

    #[test]
    fn test_set_log_fd_invalid_fd() {
        setup_log_for_test();
        cleanup_log(); // Clear any previous state

        let result = set_log_fd(-1);
        assert!(result.is_err());

        // Even though set_log_fd failed, append_log should not panic
        // but it also shouldn't write anywhere since LOG_FILE should be None
        append_log("hello after invalid fd");

        // Note: This test verifies that set_log_fd(-1) returns error
        // and append_log doesn't panic. We don't check file content
        // because LOG_FILE should be None after failed set_log_fd.
    }

    #[test]
    fn test_set_log_fd_and_append() {
        setup_log_for_test();
        cleanup_log(); // Clear any previous state

        // Create a unique temp file for this test
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let path = temp_file.path().to_str().unwrap().to_string();
        drop(temp_file); // Close the file handle, but path remains valid

        // Open with a new file handle and get fd
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        let fd = file.into_raw_fd();

        let result = set_log_fd(fd);
        assert!(result.is_ok());

        append_log("hello");

        cleanup_log();

        let mut contents = String::new();
        OpenOptions::new()
            .read(true)
            .open(&path)
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();

        let re =
            regex::Regex::new(r"^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] \[RS\] hello\n$")
                .unwrap();
        assert!(
            re.is_match(&contents),
            "Line did not match regex: {:?}",
            contents
        );
    }
}
