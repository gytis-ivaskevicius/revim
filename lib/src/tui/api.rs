use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{bindgen_prelude::*, Env};
use napi_derive::napi;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use super::render::render_frame_internal;
use super::state::{HighlightRange, Selection, VisualMode};
use super::{
    extract_modifiers, to_napi_error, wrap_decrement_u16, wrap_increment_u16, TuiContext,
    TUI_CONTEXT, TUI_RUNNING,
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
    render_frame_internal()?;

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

#[allow(deprecated)]
#[napi]
pub fn start_keyboard_listener(
    env: Env,
    mut callback: ThreadsafeFunction<KeyboardEvent>,
) -> Result<()> {
    callback.unref(&env)?;
    thread::spawn(move || {
        while TUI_RUNNING.load(Ordering::SeqCst) {
            if matches!(event::poll(Duration::from_millis(100)), Ok(true)) {
                if let Ok(Event::Key(key_event)) = event::read() {
                    let key = match key_event.code {
                        KeyCode::Up => "ArrowUp".to_string(),
                        KeyCode::Down => "ArrowDown".to_string(),
                        KeyCode::Left => "ArrowLeft".to_string(),
                        KeyCode::Right => "ArrowRight".to_string(),
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
                        KeyCode::Esc => "Escape".to_string(),
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

    Ok(())
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
            .unwrap();

        match direction.as_str() {
            "up" => (
                wrap_decrement_u16(state.cursor_row, state.max_rows()),
                state
                    .cursor_col
                    .min(state.current_line_len().saturating_sub(1)),
            ),
            "down" => (
                wrap_increment_u16(state.cursor_row, state.max_rows()),
                state
                    .cursor_col
                    .min(state.current_line_len().saturating_sub(1)),
            ),
            "left" => (
                state.cursor_row,
                wrap_decrement_u16(state.cursor_col, state.current_line_len()),
            ),
            "right" => (
                state.cursor_row,
                wrap_increment_u16(state.cursor_col, state.current_line_len()),
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
            .unwrap();
        state.cursor_row = row;
        state.cursor_col = col;
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
        .unwrap();
    Ok(state.get_line(line as u16))
}

#[napi]
pub fn get_line_count() -> Result<u32> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();
    Ok(state.demo_text.len() as u32)
}

#[napi]
pub fn get_all_lines() -> Result<Vec<String>> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();
    Ok(state.demo_text.clone())
}

#[napi]
pub fn set_all_lines(lines: Vec<String>) -> Result<()> {
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let mut state = ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();
    state.demo_text = lines;
    state.cursor_row = 0;
    state.cursor_col = 0;
    state.sync_primary_selection();
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
        .unwrap();
    Ok(CursorPosition {
        line: state.cursor_row as u32,
        ch: state.cursor_col as u32,
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
            .unwrap();

        let (line, ch) = state.clip_pos(line, ch);
        state.cursor_row = line;
        state.cursor_col = ch;
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
        .unwrap();
    Ok(state.get_range(
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
            .unwrap();

        state.replace_range(
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
        let (final_line, final_ch) = state.clip_pos(final_line, final_ch);
        state.anchor_row = final_line;
        state.anchor_col = final_ch;
        state.cursor_row = final_line;
        state.cursor_col = final_ch;
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
        .unwrap();

    let (start_line, start_ch) = (state.anchor_row, state.anchor_col);
    let (end_line, end_ch) = (state.cursor_row, state.cursor_col);

    Ok(state.get_range(start_line, start_ch, end_line, end_ch))
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
            .unwrap();

        let (anchor_line, anchor_ch) = state.clip_pos(anchor_line as u16, anchor_ch as u16);
        let (head_line, head_ch) = state.clip_pos(head_line as u16, head_ch as u16);

        state.anchor_row = anchor_line;
        state.anchor_col = anchor_ch;
        state.cursor_row = head_line;
        state.cursor_col = head_ch;
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
        .unwrap();

    Ok(state
        .selections
        .iter()
        .map(|selection| {
            state.get_range(
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
            .unwrap();

        let clipped = selections
            .into_iter()
            .map(|selection| {
                let (anchor_line, anchor_ch) =
                    state.clip_pos(selection.anchor_line as u16, selection.anchor_ch as u16);
                let (head_line, head_ch) =
                    state.clip_pos(selection.head_line as u16, selection.head_ch as u16);
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

            state.anchor_row = min_line as u16;
            state.cursor_row = max_line as u16;
            state.cursor_col = if min_col < state.anchor_col as u32 {
                min_col as u16
            } else {
                max_col.saturating_sub(1) as u16
            };
        } else {
            state.anchor_row = primary.anchor_line as u16;
            state.anchor_col = primary.anchor_ch as u16;
            state.cursor_row = primary.head_line as u16;
            state.cursor_col = primary.head_ch as u16;
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
            .unwrap();

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
            .unwrap();

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
                let start_index = state.index_from_pos(start_line, start_ch);
                let end_index = state.index_from_pos(end_line, end_ch);

                (index, selection, text, start_index, end_index)
            })
            .collect::<Vec<_>>();
        operations.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| b.4.cmp(&a.4)));

        let mut next_selections = vec![None; operations.len()];

        for (index, _selection, text, start_index, end_index) in operations {
            let start_pos = state.pos_from_index(start_index);
            let end_pos = state.pos_from_index(end_index);

            state.replace_range(&text, start_pos.0, start_pos.1, end_pos.0, end_pos.1);

            let final_index = start_index + text.chars().count() as u32;
            let (final_line, final_ch) = state.pos_from_index(final_index);
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
            state.anchor_row = primary.anchor_line as u16;
            state.anchor_col = primary.anchor_ch as u16;
            state.cursor_row = primary.head_line as u16;
            state.cursor_col = primary.head_ch as u16;
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
            .unwrap();

        if let Some(line_str) = state.demo_text.get_mut(line as usize) {
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
        .unwrap();

    Ok(state.index_from_pos(line as u16, ch as u16))
}

#[napi]
pub fn pos_from_index(offset: u32) -> Result<CursorPosition> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();

    let (line, ch) = state.pos_from_index(offset);
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
        .unwrap();

    let line_str = state.get_line(line as u16);
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
    let state = ctx
        .as_ref()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();

    Ok(ScrollInfo {
        top: 0,
        height: state.max_rows() as u32,
        client_height: 20,
    })
}

#[napi]
pub fn scroll_to(y: u32) -> Result<()> {
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = &mut ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();

    state.cursor_row = (y as u16).min(state.max_rows().saturating_sub(1));
    state.cursor_col = state
        .cursor_col
        .min(state.current_line_len().saturating_sub(1));
    state.sync_primary_selection();

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
        .unwrap();

    let (line, ch) = state.clip_pos(line as u16, ch as u16);
    Ok(CursorPosition {
        line: line as u32,
        ch: ch as u32,
    })
}

#[napi]
pub fn push_undo_stop() -> Result<()> {
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let mut state = ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();
    state.push_undo_stop();
    Ok(())
}

#[napi]
pub fn trigger_action(action: String) -> Result<()> {
    match action.as_str() {
        "undo" | "redo" | "undoLine" => {
            // Undo/redo disabled - needs proper implementation
            // See story 007 for details
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
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let state = &mut ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?
        .state
        .lock()
        .unwrap();

    state.highlights = _ranges;
    render_frame_internal()
}

#[napi]
pub fn scroll_to_line(line: u32, _position: String) -> Result<()> {
    scroll_to(line)
}

#[napi]
pub fn get_visible_lines() -> Result<VisibleLines> {
    Ok(VisibleLines { top: 0, bottom: 20 })
}

#[napi]
pub fn focus_editor() -> Result<()> {
    render_frame_internal()
}
