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

#[derive(Clone)]
#[napi(object)]
pub struct Selection {
    pub anchor_line: u32,
    pub anchor_ch: u32,
    pub head_line: u32,
    pub head_ch: u32,
}

struct TuiState {
    cursor_row: u16,
    cursor_col: u16,
    anchor_row: u16,
    anchor_col: u16,
    demo_text: Vec<String>,
    selections: Vec<Selection>,
}

#[derive(Clone)]
#[napi(object)]
pub struct HighlightRange {
    pub start_line: u32,
    pub start_ch: u32,
    pub end_line: u32,
    pub end_ch: u32,
}

impl TuiState {
    fn new() -> Self {
        let demo_text = vec![
            "Welcome to ReVim!".to_string(),
            "".to_string(),
            "This is a demo text for the TUI.".to_string(),
            "Use arrow keys to move the cursor.".to_string(),
            "Press Ctrl+C to exit.".to_string(),
            "".to_string(),
            "The cursor wraps around edges.".to_string(),
        ];
        Self {
            cursor_row: 0,
            cursor_col: 0,
            anchor_row: 0,
            anchor_col: 0,
            demo_text,
            selections: vec![Selection {
                anchor_line: 0,
                anchor_ch: 0,
                head_line: 0,
                head_ch: 0,
            }],
        }
    }

    fn ordered_range(
        start_line: u16,
        start_ch: u16,
        end_line: u16,
        end_ch: u16,
    ) -> (u16, u16, u16, u16) {
        if start_line < end_line || (start_line == end_line && start_ch <= end_ch) {
            (start_line, start_ch, end_line, end_ch)
        } else {
            (end_line, end_ch, start_line, start_ch)
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

    fn get_line(&self, line: u16) -> String {
        self.demo_text
            .get(line as usize)
            .cloned()
            .unwrap_or_default()
    }

    fn char_to_byte_index(text: &str, ch: u16) -> usize {
        text.char_indices()
            .nth(ch as usize)
            .map(|(idx, _)| idx)
            .unwrap_or(text.len())
    }

    fn get_range(&self, start_line: u16, start_ch: u16, end_line: u16, end_ch: u16) -> String {
        let (start_line, start_ch, end_line, end_ch) =
            Self::ordered_range(start_line, start_ch, end_line, end_ch);
        if start_line as usize >= self.demo_text.len() || end_line as usize >= self.demo_text.len()
        {
            return String::new();
        }
        let start_line_str = &self.demo_text[start_line as usize];
        if start_line == end_line {
            let end_ch = end_ch.min(start_line_str.chars().count() as u16);
            let start_ch = start_ch.min(end_ch);
            let start_idx = Self::char_to_byte_index(start_line_str, start_ch);
            let end_idx = Self::char_to_byte_index(start_line_str, end_ch);
            return start_line_str[start_idx..end_idx].to_string();
        }
        let start_idx = Self::char_to_byte_index(start_line_str, start_ch);
        let mut result = start_line_str[start_idx..].to_string();
        for i in (start_line + 1)..end_line {
            if let Some(line) = self.demo_text.get(i as usize) {
                result.push('\n');
                result.push_str(line);
            }
        }
        if let Some(end_line_str) = self.demo_text.get(end_line as usize) {
            result.push('\n');
            let end_ch = end_ch.min(end_line_str.chars().count() as u16);
            let end_idx = Self::char_to_byte_index(end_line_str, end_ch);
            result.push_str(&end_line_str[..end_idx]);
        }
        result
    }

    fn replace_range(
        &mut self,
        text: &str,
        start_line: u16,
        start_ch: u16,
        end_line: u16,
        end_ch: u16,
    ) {
        if start_line as usize >= self.demo_text.len() {
            return;
        }

        let (start_line, start_ch, end_line, end_ch) =
            Self::ordered_range(start_line, start_ch, end_line, end_ch);
        if end_line as usize >= self.demo_text.len() {
            return;
        }

        let start_line_str = self.demo_text[start_line as usize].clone();
        let end_line_str = self.demo_text[end_line as usize].clone();
        let start_ch = start_ch.min(start_line_str.chars().count() as u16);
        let end_ch = end_ch.min(end_line_str.chars().count() as u16);
        let start_idx = Self::char_to_byte_index(&start_line_str, start_ch);
        let end_idx = Self::char_to_byte_index(&end_line_str, end_ch);
        let prefix = start_line_str[..start_idx].to_string();
        let suffix = end_line_str[end_idx..].to_string();
        let mut replacement_lines: Vec<String> =
            text.split('\n').map(|line| line.to_string()).collect();

        if replacement_lines.is_empty() {
            replacement_lines.push(String::new());
        }

        let new_lines = if replacement_lines.len() == 1 {
            vec![format!("{}{}{}", prefix, replacement_lines[0], suffix)]
        } else {
            let last_index = replacement_lines.len() - 1;
            replacement_lines[0] = format!("{}{}", prefix, replacement_lines[0]);
            replacement_lines[last_index] = format!("{}{}", replacement_lines[last_index], suffix);
            replacement_lines
        };

        self.demo_text
            .splice(start_line as usize..=end_line as usize, new_lines);
    }

    fn clip_pos(&self, line: u16, ch: u16) -> (u16, u16) {
        let max_line = self.max_rows().saturating_sub(1);
        let line = line.min(max_line);
        let max_ch = self.get_line(line).chars().count() as u16;
        let ch = ch.min(max_ch);
        (line, ch)
    }

    fn index_from_pos(&self, line: u16, ch: u16) -> u32 {
        let mut offset = 0u32;
        for i in 0..line {
            if let Some(text) = self.demo_text.get(i as usize) {
                offset += text.chars().count() as u32 + 1;
            }
        }
        offset + ch as u32
    }

    fn pos_from_index(&self, offset: u32) -> (u16, u16) {
        let mut current_offset = 0u32;
        for (i, line) in self.demo_text.iter().enumerate() {
            let line_len = line.chars().count() as u32 + 1;
            if current_offset + line_len > offset {
                return (i as u16, (offset - current_offset) as u16);
            }
            current_offset += line_len;
        }

        let last_line = self.max_rows().saturating_sub(1);
        (last_line, self.get_line(last_line).chars().count() as u16)
    }

    fn sync_primary_selection(&mut self) {
        self.selections = vec![Selection {
            anchor_line: self.anchor_row as u32,
            anchor_ch: self.anchor_col as u32,
            head_line: self.cursor_row as u32,
            head_ch: self.cursor_col as u32,
        }];
    }
}

struct TuiContext {
    state: Mutex<TuiState>,
    terminal: Terminal<CrosstermBackend<std::io::Stdout>>,
}

static TUI_CONTEXT: Mutex<Option<TuiContext>> = Mutex::new(None);

fn to_napi_error<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(e.to_string())
}

fn wrap_decrement_u16(val: u16, max: u16) -> u16 {
    if max == 0 {
        0
    } else {
        (val + max - 1) % max
    }
}

fn wrap_increment_u16(val: u16, max: u16) -> u16 {
    if max == 0 {
        0
    } else {
        (val + 1) % max
    }
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
        state: Mutex::new(TuiState::new()),
        terminal,
    });

    TUI_RUNNING.store(true, Ordering::SeqCst);
    render_frame_internal()?;

    Ok(())
}

fn render_frame_internal() -> Result<()> {
    let (cursor_row, cursor_col, demo_text) = {
        let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_ref()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;

        let state = context.state.lock().unwrap();
        let cursor_row = state.cursor_row;
        let cursor_col = state.cursor_col;
        let demo_text: Vec<String> = state.demo_text.clone();
        (cursor_row, cursor_col, demo_text)
    };

    let lines: Vec<Line> = demo_text
        .iter()
        .enumerate()
        .map(|(row, line)| {
            if row == cursor_row as usize {
                build_highlighted_line(line, cursor_col)
            } else {
                Line::from(line.as_str())
            }
        })
        .collect();

    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;

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
    pub line: u32,
    pub ch: u32,
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
    Ok(state.max_rows() as u32)
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
    state.anchor_row = primary.anchor_line as u16;
    state.anchor_col = primary.anchor_ch as u16;
    state.cursor_row = primary.head_line as u16;
    state.cursor_col = primary.head_ch as u16;
    state.selections = clipped;
    Ok(())
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

        let mut next_selections = Vec::with_capacity(state.selections.len());
        let mut offset_adjustment: i32 = 0;

        for (selection, text) in state
            .selections
            .clone()
            .into_iter()
            .zip(replacements.into_iter())
        {
            let start_line = selection.anchor_line as u16;
            let start_ch = selection.anchor_ch as u16;
            let end_line = selection.head_line as u16;
            let end_ch = selection.head_ch as u16;
            let start_index = state.index_from_pos(start_line, start_ch) as i32 + offset_adjustment;
            let end_index = state.index_from_pos(end_line, end_ch) as i32 + offset_adjustment;
            let start_pos = state.pos_from_index(start_index.max(0) as u32);
            let end_pos = state.pos_from_index(end_index.max(0) as u32);

            state.replace_range(&text, start_pos.0, start_pos.1, end_pos.0, end_pos.1);

            let inserted_len = text.chars().count() as i32;
            let removed_len = (end_index - start_index).max(0);
            let final_index = start_index + inserted_len;
            offset_adjustment += inserted_len - removed_len;
            let (final_line, final_ch) = state.pos_from_index(final_index.max(0) as u32);
            next_selections.push(Selection {
                anchor_line: final_line as u32,
                anchor_ch: final_ch as u32,
                head_line: final_line as u32,
                head_ch: final_ch as u32,
            });
        }

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
pub fn indent_line(line: u32, _indent_right: bool) -> Result<()> {
    {
        let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let state = &mut ctx
            .as_mut()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?
            .state
            .lock()
            .unwrap();

        if let Some(line_str) = state.demo_text.get_mut(line as usize) {
            line_str.insert(0, '\t');
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

#[napi(object)]
pub struct ScrollInfo {
    pub top: u32,
    pub height: u32,
    pub client_height: u32,
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
pub fn scroll_to(_y: u32) -> Result<()> {
    Ok(())
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
    Ok(())
}

#[napi]
pub fn trigger_action(action: String) -> Result<()> {
    match action.as_str() {
        "redo" | "undo" | "formatSelection" => Ok(()),
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
    Ok(())
}

#[napi]
pub fn set_replace_mode(_active: bool) -> Result<()> {
    Ok(())
}

#[napi]
pub fn set_highlights(_ranges: Vec<HighlightRange>) -> Result<()> {
    Ok(())
}

#[napi]
pub fn scroll_to_line(_line: u32, _position: String) -> Result<()> {
    Ok(())
}

#[napi(object)]
pub struct VisibleLines {
    pub top: u32,
    pub bottom: u32,
}

#[napi]
pub fn get_visible_lines() -> Result<VisibleLines> {
    Ok(VisibleLines { top: 0, bottom: 20 })
}

#[napi]
pub fn focus_editor() -> Result<()> {
    Ok(())
}
