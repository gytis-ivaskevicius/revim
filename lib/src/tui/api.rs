use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use napi::bindgen_prelude::*;
use napi::Task;
use napi_derive::napi;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::{Condvar, Mutex as StdMutex};
use std::thread;
use std::time::Duration;

use super::render::render_frame_internal;
use super::state::{BufferState, HighlightRange, Selection, VisualMode};
use super::{
    extract_modifiers, revim_log, to_napi_error, wrap_decrement_u16, wrap_increment_u16,
    TuiContext, TUI_CONTEXT, TUI_RUNNING,
};

#[napi(object)]
pub struct KeyboardEvent {
    pub key: String,
    pub modifiers: Vec<String>,
}

#[napi(object)]
pub struct CursorPosition {
    pub line: u32,
    pub ch: u32,
}

#[napi(object)]
pub struct ScrollInfo {
    pub top: u32,
    pub height: u32,
    pub client_height: u32,
}

#[napi(object)]
pub struct VisibleLines {
    pub top: u32,
    pub bottom: u32,
}

#[napi(object)]
pub struct BufferInfo {
    pub index: u32,
    pub path: Option<String>,
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

    *TUI_CONTEXT.lock().map_err(to_napi_error)? = Some(TuiContext::new(terminal));

    TUI_RUNNING.store(true, Ordering::SeqCst);
    revim_log!("init_tui: TUI initialized");
    render_frame_internal()?;

    Ok(())
}

#[napi]
pub fn load_file(path: String) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let mut state = context.state.lock().map_err(to_napi_error)?;

        // Always track the current path, even on read failure (matching Vim behavior)
        state.active_mut().current_path = Some(path.clone());

        match std::fs::read_to_string(&path) {
            Ok(content) => {
                let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
                state.set_lines(lines);
            }
            Err(err) => {
                state.set_lines(vec![format!("Error opening '{}': {}", path, err)]);
            }
        }
    }
    render_frame_internal()
}

#[napi]
pub fn get_current_path() -> Result<Option<String>> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let state = context.state.lock().map_err(to_napi_error)?;
    Ok(state.active().current_path.clone())
}

#[napi]
pub fn set_current_path(path: String) -> Result<()> {
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let mut state = context.state.lock().map_err(to_napi_error)?;
    state.active_mut().current_path = Some(path);
    Ok(())
}

#[napi]
pub fn save_file(path: String) -> Result<()> {
    let lines = {
        let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_ref()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let state = context.state.lock().map_err(to_napi_error)?;
        state.active().lines.clone()
    }; // Drop all locks before I/O

    let content = lines.join("\n") + "\n";
    std::fs::write(&path, content).map_err(to_napi_error)?;
    Ok(())
}

#[napi]
pub fn shutdown_tui() -> Result<()> {
    TUI_RUNNING.store(false, Ordering::SeqCst);

    *TUI_CONTEXT.lock().map_err(to_napi_error)? = None;

    revim_log!("shutdown_tui: TUI shut down");

    disable_raw_mode().map_err(to_napi_error)?;
    execute!(std::io::stdout(), LeaveAlternateScreen).map_err(to_napi_error)?;

    Ok(())
}

struct KeyboardQueue {
    queue: StdMutex<VecDeque<KeyboardEvent>>,
    condvar: Condvar,
}

static KEYBOARD_QUEUE: KeyboardQueue = KeyboardQueue {
    queue: StdMutex::new(VecDeque::new()),
    condvar: Condvar::new(),
};

#[napi]
pub fn start_keyboard_listener() -> Result<()> {
    thread::spawn(move || {
        revim_log!("keyboard_listener: thread started");
        while TUI_RUNNING.load(Ordering::SeqCst) {
            let poll_result = event::poll(Duration::from_millis(100));
            match poll_result {
                Ok(true) => {
                    let read_result = event::read();
                    if let Ok(Event::Key(key_event)) = read_result {
                        let key = match key_event.code {
                            KeyCode::Up => "Up".to_string(),
                            KeyCode::Down => "Down".to_string(),
                            KeyCode::Left => "Left".to_string(),
                            KeyCode::Right => "Right".to_string(),
                            KeyCode::Delete => "Delete".to_string(),
                            KeyCode::Insert => "Insert".to_string(),
                            KeyCode::Home => "Home".to_string(),
                            KeyCode::End => "End".to_string(),
                            KeyCode::PageUp => "PageUp".to_string(),
                            KeyCode::PageDown => "PageDown".to_string(),
                            KeyCode::Char(c) => c.to_string(),
                            KeyCode::Enter => "Enter".to_string(),
                            KeyCode::Backspace => "Backspace".to_string(),
                            KeyCode::Tab => "Tab".to_string(),
                            KeyCode::Esc => "Esc".to_string(),
                            _ => continue,
                        };

                        let modifiers = extract_modifiers(key_event.modifiers);
                        {
                            let mut queue = KEYBOARD_QUEUE.queue.lock().unwrap_or_else(|e| e.into_inner());
                            queue.push_back(KeyboardEvent { key, modifiers });
                        }
                        KEYBOARD_QUEUE.condvar.notify_one();
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    revim_log!("keyboard_listener: poll error: {:?}", e);
                }
            }
        }
        revim_log!("keyboard_listener: thread exiting");
    });

    Ok(())
}

pub struct WaitForKeyEvent;

impl Task for WaitForKeyEvent {
    type Output = KeyboardEvent;
    type JsValue = KeyboardEvent;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut queue = KEYBOARD_QUEUE.queue.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(event) = queue.pop_front() {
                return Ok(event);
            }
            // Wait for signal, but check TUI_RUNNING periodically
            let result = KEYBOARD_QUEUE
                .condvar
                .wait_timeout(queue, Duration::from_millis(100));
            match result {
                Ok((q, timeout)) => {
                    queue = q;
                    if timeout.timed_out() && !TUI_RUNNING.load(Ordering::SeqCst) {
                        return Err(Error::from_reason("TUI shutting down"));
                    }
                }
                Err(e) => {
                    queue = e.into_inner().0;
                    if !TUI_RUNNING.load(Ordering::SeqCst) {
                        return Err(Error::from_reason("TUI shutting down"));
                    }
                }
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn wait_for_keyboard_event() -> AsyncTask<WaitForKeyEvent> {
    AsyncTask::new(WaitForKeyEvent)
}

#[napi]
pub fn move_cursor(direction: String) -> Result<CursorPosition> {
    let (row, col) = {
        let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = ctx
            .as_ref()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        let active = state.active();
        match direction.as_str() {
            "up" => (
                wrap_decrement_u16(active.cursor_row, active.max_rows()),
                active
                    .cursor_col
                    .min(active.current_line_len().saturating_sub(1)),
            ),
            "down" => (
                wrap_increment_u16(active.cursor_row, active.max_rows()),
                active
                    .cursor_col
                    .min(active.current_line_len().saturating_sub(1)),
            ),
            "left" => (
                active.cursor_row,
                wrap_decrement_u16(active.cursor_col, active.current_line_len()),
            ),
            "right" => (
                active.cursor_row,
                wrap_increment_u16(active.cursor_col, active.current_line_len()),
            ),
            _ => return Err(to_napi_error(format!("Invalid direction: {}", direction))),
        }
    };

    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;
        state.active_mut().cursor_row = row;
        state.active_mut().cursor_col = col;
        state.sync_primary_selection();
    }

    render_frame_internal()?;

    Ok(CursorPosition {
        line: row as u32,
        ch: col as u32,
    })
}

#[napi]
pub fn get_line(line: u32) -> Result<String> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;
    Ok(state.active().get_line(line as u16))
}

#[napi]
pub fn get_line_count() -> Result<u32> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;
    Ok(state.active().lines.len() as u32)
}

#[napi]
pub fn get_all_lines() -> Result<Vec<String>> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;
    Ok(state.active().lines.clone())
}

#[napi]
pub fn set_all_lines(lines: Vec<String>) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let mut state = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;
        state.active_mut().set_lines(lines);
    }
    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn get_cursor_pos() -> Result<CursorPosition> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;
    let active = state.active();
    Ok(CursorPosition {
        line: active.cursor_row as u32,
        ch: active.cursor_col as u32,
    })
}

#[napi]
pub fn set_cursor_pos(line: u32, ch: u32) -> Result<()> {
    {
        let line = line as u16;
        let ch = ch as u16;
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        let (line, ch) = state.active().clip_pos(line, ch);
        state.active_mut().cursor_row = line;
        state.active_mut().cursor_col = ch;
        state.sync_primary_selection();
    }
    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn get_range(start_line: u32, start_ch: u32, end_line: u32, end_ch: u32) -> Result<String> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;
    Ok(state.active().get_range(
        start_line as u16,
        start_ch as u16,
        end_line as u16,
        end_ch as u16,
    ))
}

#[napi]
pub fn replace_range(
    text: String,
    start_line: u32,
    start_ch: u32,
    end_line: u32,
    end_ch: u32,
) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        state.active_mut().replace_range(
            &text,
            start_line as u16,
            start_ch as u16,
            end_line as u16,
            end_ch as u16,
        );
        let inserted_lines: Vec<&str> = text.split('\n').collect();
        let final_line = start_line as u16 + inserted_lines.len().saturating_sub(1) as u16;
        let final_ch = if inserted_lines.len() == 1 {
            start_ch as u16 + inserted_lines[0].chars().count() as u16
        } else {
            inserted_lines.last().unwrap_or(&"").chars().count() as u16
        };
        let (final_line, final_ch) = state.active().clip_pos(final_line, final_ch);
        state.active_mut().anchor_row = final_line;
        state.active_mut().anchor_col = final_ch;
        state.active_mut().cursor_row = final_line;
        state.active_mut().cursor_col = final_ch;
        state.sync_primary_selection();
    }
    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn get_selection() -> Result<String> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;

    let active = state.active();
    let (start_line, start_ch) = (active.anchor_row, active.anchor_col);
    let (end_line, end_ch) = (active.cursor_row, active.cursor_col);

    Ok(active.get_range(start_line, start_ch, end_line, end_ch))
}

#[napi]
pub fn set_selection(anchor_line: u32, anchor_ch: u32, head_line: u32, head_ch: u32) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        let (anchor_line, anchor_ch) = state.active().clip_pos(anchor_line as u16, anchor_ch as u16);
        let (head_line, head_ch) = state.active().clip_pos(head_line as u16, head_ch as u16);

        state.active_mut().anchor_row = anchor_line;
        state.active_mut().anchor_col = anchor_ch;
        state.active_mut().cursor_row = head_line;
        state.active_mut().cursor_col = head_ch;
        state.sync_primary_selection();
    }

    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn get_selections() -> Result<Vec<String>> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;

    Ok(state
        .selections
        .iter()
        .map(|selection| {
            state.active().get_range(
                selection.anchor_line as u16,
                selection.anchor_ch as u16,
                selection.head_line as u16,
                selection.head_ch as u16,
            )
        })
        .collect())
}

#[napi]
pub fn set_selections(selections: Vec<Selection>) -> Result<()> {
    if selections.is_empty() {
        return Ok(());
    }

    let non_empty_block_selections: Vec<&Selection> = selections
        .iter()
        .filter(|selection| selection.anchor_ch != selection.head_ch)
        .collect();
    let block_bound_source = if non_empty_block_selections.is_empty() {
        selections.iter().collect::<Vec<_>>()
    } else {
        non_empty_block_selections
    };
    let block_bounds = if block_bound_source.is_empty() {
        None
    } else {
        Some((
            block_bound_source
                .iter()
                .map(|selection| selection.anchor_line.min(selection.head_line))
                .min()
                .unwrap_or(0),
            block_bound_source
                .iter()
                .map(|selection| selection.anchor_line.max(selection.head_line))
                .max()
                .unwrap_or(0),
        ))
    };

    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        let clipped = selections
            .into_iter()
            .map(|selection| {
                let (anchor_line, anchor_ch) =
                    state.active().clip_pos(selection.anchor_line as u16, selection.anchor_ch as u16);
                let (head_line, head_ch) =
                    state.active().clip_pos(selection.head_line as u16, selection.head_ch as u16);
                Selection {
                    anchor_line: anchor_line as u32,
                    anchor_ch: anchor_ch as u32,
                    head_line: head_line as u32,
                    head_ch: head_ch as u32,
                }
            })
            .collect::<Vec<_>>();

        let primary = clipped[0].clone();
        if state.visual_mode == VisualMode::Block {
            let (min_line, max_line) =
                block_bounds.unwrap_or((primary.anchor_line, primary.head_line));
            let block_col_source: Vec<&Selection> = clipped
                .iter()
                .filter(|selection| selection.anchor_ch != selection.head_ch)
                .collect();
            let block_col_source = if block_col_source.is_empty() {
                clipped.iter().collect::<Vec<_>>()
            } else {
                block_col_source
            };
            let min_col = block_col_source
                .iter()
                .map(|selection| selection.anchor_ch.min(selection.head_ch))
                .min()
                .unwrap_or(primary.anchor_ch);
            let max_col = block_col_source
                .iter()
                .map(|selection| selection.anchor_ch.max(selection.head_ch))
                .max()
                .unwrap_or(primary.head_ch);

            let current_anchor_col = state.active().anchor_col;
            state.active_mut().anchor_row = min_line as u16;
            state.active_mut().cursor_row = max_line as u16;
            state.active_mut().cursor_col = if min_col < current_anchor_col as u32 {
                min_col as u16
            } else {
                max_col.saturating_sub(1) as u16
            };
        } else {
            state.active_mut().anchor_row = primary.anchor_line as u16;
            state.active_mut().anchor_col = primary.anchor_ch as u16;
            state.active_mut().cursor_row = primary.head_line as u16;
            state.active_mut().cursor_col = primary.head_ch as u16;
        }
        state.selections = clipped;
    }

    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn set_visual_mode(mode: String) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        state.visual_mode = match mode.as_str() {
            "char" => VisualMode::Char,
            "line" => VisualMode::Line,
            "block" => VisualMode::Block,
            _ => VisualMode::None,
        };
    }

    render_frame_internal()
}

#[napi]
pub fn replace_selections(texts: Vec<String>) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        let replacements = if texts.len() == state.selections.len() {
            texts
        } else if texts.len() == 1 {
            vec![texts[0].clone(); state.selections.len()]
        } else {
            return Err(to_napi_error(
                "replaceSelections requires 1 or N replacement texts",
            ));
        };

        let mut operations = state
            .selections
            .clone()
            .into_iter()
            .zip(replacements)
            .enumerate()
            .map(|(index, (selection, text))| {
                let start_line = selection.anchor_line as u16;
                let start_ch = selection.anchor_ch as u16;
                let end_line = selection.head_line as u16;
                let end_ch = selection.head_ch as u16;
                let start_index = state.active().index_from_pos(start_line, start_ch);
                let end_index = state.active().index_from_pos(end_line, end_ch);

                (index, selection, text, start_index, end_index)
            })
            .collect::<Vec<_>>();
        operations.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| b.4.cmp(&a.4)));

        let mut next_selections = vec![None; operations.len()];

        for (index, _selection, text, start_index, end_index) in operations {
            let start_pos = state.active().pos_from_index(start_index);
            let end_pos = state.active().pos_from_index(end_index);

            state.active_mut().replace_range(&text, start_pos.0, start_pos.1, end_pos.0, end_pos.1);

            let final_index = start_index + text.chars().count() as u32;
            let (final_line, final_ch) = state.active().pos_from_index(final_index);
            next_selections[index] = Some(Selection {
                anchor_line: final_line as u32,
                anchor_ch: final_ch as u32,
                head_line: final_line as u32,
                head_ch: final_ch as u32,
            });
        }

        let next_selections = next_selections.into_iter().flatten().collect::<Vec<_>>();
        state.selections = next_selections.clone();
        if let Some(primary) = next_selections.first() {
            state.active_mut().anchor_row = primary.anchor_line as u16;
            state.active_mut().anchor_col = primary.anchor_ch as u16;
            state.active_mut().cursor_row = primary.head_line as u16;
            state.active_mut().cursor_col = primary.head_ch as u16;
        }
    }
    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn indent_line(line: u32, indent_right: bool) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        if let Some(line_str) = state.active_mut().lines.get_mut(line as usize) {
            if indent_right {
                line_str.insert(0, '\t');
            } else if let Some(first_char) = line_str.chars().next() {
                if first_char == '\t' {
                    line_str.remove(0);
                } else if first_char == ' ' {
                    let remove_count = line_str.chars().take_while(|ch| *ch == ' ').take(2).count();
                    line_str.drain(0..remove_count);
                }
            }
        }
    }
    render_frame_internal()?;
    Ok(())
}

#[napi]
pub fn index_from_pos(line: u32, ch: u32) -> Result<u32> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;

    Ok(state.active().index_from_pos(line as u16, ch as u16))
}

#[napi]
pub fn pos_from_index(offset: u32) -> Result<CursorPosition> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;

    let (line, ch) = state.active().pos_from_index(offset);
    Ok(CursorPosition {
        line: line as u32,
        ch: ch as u32,
    })
}

#[napi]
pub fn get_line_first_non_whitespace(line: u32) -> Result<u32> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;

    let line_str = state.active().get_line(line as u16);
    for (i, ch) in line_str.chars().enumerate() {
        if !ch.is_whitespace() {
            return Ok(i as u32);
        }
    }

    Ok(line_str.chars().count() as u32)
}

#[napi]
pub fn get_scroll_info() -> Result<ScrollInfo> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let state = context.state.lock().map_err(to_napi_error)?;
    let viewport_height = context.viewport_height.load(Ordering::Relaxed);

    Ok(ScrollInfo {
        top: state.active().scroll_top as u32,
        height: state.active().max_rows() as u32,
        client_height: viewport_height as u32,
    })
}

#[napi]
pub fn scroll_to(y: u32) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let viewport_height = context.viewport_height.load(Ordering::Relaxed);
        let mut state = context.state.lock().map_err(to_napi_error)?;
        let max_scroll = state.active().max_scroll_top(viewport_height);
        state.active_mut().scroll_top = (y as u16).min(max_scroll);
    }

    render_frame_internal()
}

#[napi]
pub fn clip_pos(line: u32, ch: u32) -> Result<CursorPosition> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .map_err(to_napi_error)?;

    let (line, ch) = state.active().clip_pos(line as u16, ch as u16);
    Ok(CursorPosition {
        line: line as u32,
        ch: ch as u32,
    })
}

#[napi]
pub fn push_undo_stop() -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        let snapshot = state.active().snapshot();
        state.active_mut().undo_stack.push(snapshot);
        state.active_mut().redo_stack.clear();
    }
    Ok(())
}

#[napi]
pub fn undo() -> Result<CursorPosition> {
    let (row, col) = {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        if state.active().undo_stack.is_empty() {
            return Ok(CursorPosition {
                line: state.active().cursor_row as u32,
                ch: state.active().cursor_col as u32,
            });
        }

        // Push current state to redo stack
        let current = state.active().snapshot();
        state.active_mut().redo_stack.push(current);

        // Pop from undo stack and restore
        let snapshot = state.active_mut().undo_stack.pop().unwrap();
        state.active_mut().restore_snapshot(&snapshot);
        state.sync_primary_selection();

        (state.active().cursor_row, state.active().cursor_col)
    };

    render_frame_internal()?;

    Ok(CursorPosition {
        line: row as u32,
        ch: col as u32,
    })
}

#[napi]
pub fn redo() -> Result<CursorPosition> {
    let (row, col) = {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        if state.active().redo_stack.is_empty() {
            return Ok(CursorPosition {
                line: state.active().cursor_row as u32,
                ch: state.active().cursor_col as u32,
            });
        }

        // Push current state to undo stack
        let current = state.active().snapshot();
        state.active_mut().undo_stack.push(current);

        // Pop from redo stack and restore
        let snapshot = state.active_mut().redo_stack.pop().unwrap();
        state.active_mut().restore_snapshot(&snapshot);
        state.sync_primary_selection();

        (state.active().cursor_row, state.active().cursor_col)
    };

    render_frame_internal()?;

    Ok(CursorPosition {
        line: row as u32,
        ch: col as u32,
    })
}

#[napi]
pub fn trigger_action(action: String) -> Result<()> {
    match action.as_str() {
        "undo" | "redo" | "undoLine" => {
            // Undo/redo is now handled via native NAPI functions
            // Keep backward compatibility - redirect to native functions
            if action == "undo" {
                return undo().map(|_| ());
            } else if action == "redo" {
                return redo().map(|_| ());
            }
            // undoLine falls through to no-op
            Ok(())
        }
        "formatSelection" => {
            let cursor = get_cursor_pos()?;
            indent_line(cursor.line, true)
        }
        "editor.action.insertLineAfter" => {
            let cursor = get_cursor_pos()?;
            let line = get_line(cursor.line)?;
            replace_range(
                "\n".to_string(),
                cursor.line,
                line.chars().count() as u32,
                cursor.line,
                line.chars().count() as u32,
            )
        }
        _ => Err(to_napi_error(format!(
            "Unsupported editor action: {action}"
        ))),
    }
}

#[napi]
pub fn set_vim_mode(_active: bool) -> Result<()> {
    render_frame_internal()
}

#[napi]
pub fn set_replace_mode(_active: bool) -> Result<()> {
    render_frame_internal()
}

#[napi]
pub fn set_highlights(_ranges: Vec<HighlightRange>) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;

        state.highlights = _ranges;
    }
    render_frame_internal()
}

#[napi]
pub fn scroll_to_line(line: u32, position: String) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let viewport_height = context.viewport_height.load(Ordering::Relaxed);
        let mut state = context.state.lock().map_err(to_napi_error)?;
        let line = line as u16;
        let new_scroll_top = match position.as_str() {
            "top" => line,
            "center" => line.saturating_sub(viewport_height / 2),
            "bottom" => line.saturating_sub(viewport_height - 1),
            _ => line,
        };
        let max_scroll = state.active().max_scroll_top(viewport_height);
        state.active_mut().scroll_top = new_scroll_top.min(max_scroll);
    }

    render_frame_internal()
}

#[napi]
pub fn get_visible_lines() -> Result<VisibleLines> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let state = context.state.lock().map_err(to_napi_error)?;
    let viewport_height = context.viewport_height.load(Ordering::Relaxed).max(1);
    let total_lines = state.active().max_rows();

    let top = state.active().scroll_top;
    let bottom = (top + viewport_height - 1).min(total_lines.saturating_sub(1));

    Ok(VisibleLines {
        top: top as u32,
        bottom: bottom as u32,
    })
}

#[napi]
pub fn focus_editor() -> Result<()> {
    render_frame_internal()
}

#[napi]
pub fn get_terminal_width() -> Result<u16> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let size = context.terminal.size().map_err(to_napi_error)?;
    Ok(size.width)
}

#[napi]
pub fn set_status_text(text: String) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .map_err(to_napi_error)?;
        state.status_text = text;
    }
    render_frame_internal()
}

// Buffer management functions

#[napi]
pub fn open_buffer(path: String) -> Result<BufferInfo> {
    // Read file outside any locks
    let file_content = std::fs::read_to_string(&path);

    let (index, path_clone) = {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let mut state = context.state.lock().map_err(to_napi_error)?;

        let mut buf = BufferState::new();
        buf.current_path = Some(path.clone());

        match file_content {
            Ok(ref content) => {
                let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
                if lines.is_empty() {
                    buf.lines = vec![String::new()];
                } else {
                    buf.lines = lines;
                }
            }
            Err(ref err) => {
                buf.lines = vec![format!("Error opening '{}': {}", path, err)];
            }
        }

        let index = state.buffers.len();
        state.buffers.push(buf);
        (index as u32, state.buffers[index].current_path.clone())
    };

    Ok(BufferInfo {
        index,
        path: path_clone,
    })
}

#[napi]
pub fn switch_to_buffer(index: u32) -> Result<BufferInfo> {
    let path;
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let mut state = context.state.lock().map_err(to_napi_error)?;

        if !state.switch_to(index as usize) {
            return Err(to_napi_error(format!(
                "Invalid buffer index: {}",
                index
            )));
        }
        path = state.active().current_path.clone();
    }

    render_frame_internal()?;

    Ok(BufferInfo {
        index,
        path,
    })
}

#[napi]
pub fn next_buffer() -> Result<BufferInfo> {
    let index;
    let path;
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let mut state = context.state.lock().map_err(to_napi_error)?;

        index = state.next_buffer() as u32;
        path = state.active().current_path.clone();
    }

    render_frame_internal()?;

    Ok(BufferInfo {
        index,
        path,
    })
}

#[napi]
pub fn prev_buffer() -> Result<BufferInfo> {
    let index;
    let path;
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;
        let mut state = context.state.lock().map_err(to_napi_error)?;

        index = state.prev_buffer() as u32;
        path = state.active().current_path.clone();
    }

    render_frame_internal()?;

    Ok(BufferInfo {
        index,
        path,
    })
}

#[napi]
pub fn get_buffer_count() -> Result<u32> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let state = context.state.lock().map_err(to_napi_error)?;
    Ok(state.buffers.len() as u32)
}

#[napi]
pub fn get_current_buffer_index() -> Result<u32> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let state = context.state.lock().map_err(to_napi_error)?;
    Ok(state.active as u32)
}
