mod api;
mod render;
pub mod state;

use crossterm::event::KeyModifiers;
use napi::bindgen_prelude::*;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU16;
use std::sync::Mutex;

use state::TuiState;

pub use api::*;
pub use state::{HighlightRange, Selection};

pub(crate) static TUI_RUNNING: AtomicBool = AtomicBool::new(false);

pub(crate) struct TuiContext {
    pub state: Mutex<TuiState>,
    pub terminal: Terminal<CrosstermBackend<std::io::Stdout>>,
    pub viewport_height: AtomicU16,
}

impl TuiContext {
    pub fn new(terminal: Terminal<CrosstermBackend<std::io::Stdout>>) -> Self {
        Self {
            state: Mutex::new(TuiState::new()),
            terminal,
            viewport_height: AtomicU16::new(27),
        }
    }
}

pub(crate) static TUI_CONTEXT: Mutex<Option<TuiContext>> = Mutex::new(None);

pub(crate) fn to_napi_error<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(e.to_string())
}

pub(crate) fn wrap_decrement_u16(val: u16, max: u16) -> u16 {
    if max == 0 {
        0
    } else {
        (val + max - 1) % max
    }
}

pub(crate) fn wrap_increment_u16(val: u16, max: u16) -> u16 {
    if max == 0 {
        0
    } else {
        (val + 1) % max
    }
}

pub(crate) fn extract_modifiers(modifiers: KeyModifiers) -> Vec<String> {
    let mut mods = Vec::new();
    if modifiers.contains(KeyModifiers::CONTROL) {
        mods.push("Ctrl".to_string());
    }
    if modifiers.contains(KeyModifiers::SHIFT) {
        mods.push("Shift".to_string());
    }
    if modifiers.contains(KeyModifiers::ALT) {
        mods.push("Alt".to_string());
    }
    mods
}
