use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::thread;
use std::time::Duration;
use tokio::time::sleep;

#[napi]
fn greet(name: String) -> String {
    format!("Hello, {}!", name)
}

#[napi]
async fn fetch_data(id: u32) -> Result<String> {
    sleep(Duration::from_millis(100)).await;
    Ok(format!("Data for ID {}", id))
}

#[napi]
fn start_counter(callback: ThreadsafeFunction<u32>) {
    thread::spawn(move || {
        for i in 0..5 {
            callback.call(Ok(i), ThreadsafeFunctionCallMode::NonBlocking);
            thread::sleep(Duration::from_millis(500));
        }
    });
}