use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use ratatui::{
    backend::CrosstermBackend,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Terminal,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

static TUI_RUNNING: AtomicBool = AtomicBool::new(false);

struct TuiState {
    cursor_row: u16,
    cursor_col: u16,
    demo_text: &'static [&'static str],
}

impl TuiState {
    fn new() -> Self {
        const DEMO_TEXT: &[&str] = &[
            "Welcome to ReVim!",
            "",
            "This is a demo text for the TUI.",
            "Use arrow keys to move the cursor.",
            "Press Ctrl+C to exit.",
            "",
            "The cursor wraps around edges.",
        ];
        Self {
            cursor_row: 0,
            cursor_col: 0,
            demo_text: DEMO_TEXT,
        }
    }

    fn max_rows(&self) -> u16 {
        self.demo_text.len() as u16
    }

    fn current_line_len(&self) -> u16 {
        self.demo_text
            .get(self.cursor_row as usize)
            .map(|s| s.len() as u16)
            .unwrap_or(0)
            .max(1)
    }
}

struct TuiContext {
    state: TuiState,
    terminal: Terminal<CrosstermBackend<std::io::Stdout>>,
}

static TUI_CONTEXT: Mutex<Option<TuiContext>> = Mutex::new(None);

fn to_napi_error<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(e.to_string())
}

fn wrap_decrement(val: u16, max: u16) -> u16 {
    (val + max - 1) % max
}

fn wrap_increment(val: u16, max: u16) -> u16 {
    (val + 1) % max
}

fn extract_modifiers(modifiers: KeyModifiers) -> Vec<String> {
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

fn build_highlighted_line(line: &str, cursor_col: u16) -> Line<'_> {
    let chars: Vec<char> = line.chars().collect();
    let col = cursor_col as usize;
    let spans: Vec<Span> = chars
        .iter()
        .enumerate()
        .map(|(i, ch)| {
            if i == col {
                Span::styled(
                    ch.to_string(),
                    Style::default().add_modifier(Modifier::REVERSED),
                )
            } else {
                Span::raw(ch.to_string())
            }
        })
        .collect();
    Line::from(spans)
}

#[napi]
pub fn init_tui() -> Result<()> {
    enable_raw_mode().map_err(to_napi_error)?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|e| {
        let _ = disable_raw_mode();
        to_napi_error(e)
    })?;

    let backend = CrosstermBackend::new(stdout);
    let terminal = Terminal::new(backend).map_err(|e| {
        let _ = disable_raw_mode();
        let _ = execute!(std::io::stdout(), LeaveAlternateScreen);
        to_napi_error(e)
    })?;

    *TUI_CONTEXT.lock().map_err(to_napi_error)? = Some(TuiContext {
        state: TuiState::new(),
        terminal,
    });

    TUI_RUNNING.store(true, Ordering::SeqCst);
    render_frame_internal()?;

    Ok(())
}

fn render_frame_internal() -> Result<()> {
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;

    let cursor_row = context.state.cursor_row;
    let cursor_col = context.state.cursor_col;
    let demo_text = context.state.demo_text;

    let lines: Vec<Line> = demo_text
        .iter()
        .enumerate()
        .map(|(row, line)| {
            if row == cursor_row as usize {
                build_highlighted_line(line, cursor_col)
            } else {
                Line::from(*line)
            }
        })
        .collect();

    context
        .terminal
        .draw(|f| {
            let size = f.area();
            let block = Block::default().borders(Borders::ALL).title("ReVim");
            let paragraph = Paragraph::new(lines)
                .block(block.clone())
                .alignment(ratatui::layout::Alignment::Left);
            f.render_widget(paragraph, size);
            let inner_area = block.inner(size);
            f.set_cursor_position((inner_area.x + cursor_col, inner_area.y + cursor_row));
        })
        .map_err(to_napi_error)?;

    Ok(())
}

#[napi]
pub fn shutdown_tui() -> Result<()> {
    TUI_RUNNING.store(false, Ordering::SeqCst);

    *TUI_CONTEXT.lock().map_err(to_napi_error)? = None;

    disable_raw_mode().map_err(to_napi_error)?;
    execute!(std::io::stdout(), LeaveAlternateScreen).map_err(to_napi_error)?;

    Ok(())
}

#[napi(object)]
pub struct KeyboardEvent {
    pub key: String,
    pub modifiers: Vec<String>,
}

#[napi(object)]
pub struct CursorPosition {
    pub row: u16,
    pub col: u16,
}

#[napi]
pub fn start_keyboard_listener(callback: ThreadsafeFunction<KeyboardEvent>) {
    thread::spawn(move || {
        while TUI_RUNNING.load(Ordering::SeqCst) {
            if event::poll(Duration::from_millis(100)).is_ok() {
                if let Ok(Event::Key(key_event)) = event::read() {
                    let key = match key_event.code {
                        KeyCode::Up => "ArrowUp".to_string(),
                        KeyCode::Down => "ArrowDown".to_string(),
                        KeyCode::Left => "ArrowLeft".to_string(),
                        KeyCode::Right => "ArrowRight".to_string(),
                        KeyCode::Char(c) => c.to_string(),
                        _ => continue,
                    };

                    let modifiers = extract_modifiers(key_event.modifiers);
                    callback.call(
                        Ok(KeyboardEvent { key, modifiers }),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
            }
        }
    });
}

#[napi]
pub fn move_cursor(direction: String) -> Result<CursorPosition> {
    let (row, col) = {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state;

        match direction.as_str() {
            "up" => {
                state.cursor_row = wrap_decrement(state.cursor_row, state.max_rows());
                state.cursor_col = state.cursor_col.min(state.current_line_len() - 1);
            }
            "down" => {
                state.cursor_row = wrap_increment(state.cursor_row, state.max_rows());
                state.cursor_col = state.cursor_col.min(state.current_line_len() - 1);
            }
            "left" => {
                state.cursor_col = wrap_decrement(state.cursor_col, state.current_line_len());
            }
            "right" => {
                state.cursor_col = wrap_increment(state.cursor_col, state.current_line_len());
            }
            _ => return Err(to_napi_error(format!("Invalid direction: {}", direction))),
        }

        (state.cursor_row, state.cursor_col)
    };

    render_frame_internal()?;

    Ok(CursorPosition { row, col })
}
