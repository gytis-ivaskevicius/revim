use napi::bindgen_prelude::*;
use ratatui::{
    layout::{Alignment, Constraint, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
};
use std::sync::atomic::Ordering;

use super::state::{TuiState, VisualMode};
use super::{to_napi_error, TUI_CONTEXT};

pub fn build_highlighted_line<'a>(line: &'a str, highlights: &[(u16, u16)]) -> Line<'a> {
    let chars: Vec<char> = line.chars().collect();
    let max_highlight_end = highlights
        .iter()
        .map(|(_, end)| *end as usize)
        .max()
        .unwrap_or(0);
    let width = chars.len().max(max_highlight_end);
    let spans: Vec<Span> = (0..width)
        .map(|i| {
            let ch = chars.get(i).copied().unwrap_or(' ');
            let is_highlighted = highlights
                .iter()
                .any(|(start, end)| i >= *start as usize && i < *end as usize);
            if is_highlighted {
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

pub fn render_frame_internal() -> Result<()> {
    // Phase 1: Size phase - inside first TuiState Mutex lock
    let (
        cursor_row,
        cursor_col,
        anchor_row,
        anchor_col,
        visual_mode,
        demo_text,
        highlights,
        selections,
        status_text,
        scroll_top,
        viewport_height,
    ) = {
        let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_ref()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;

        // Compute viewport_height from terminal size
        let terminal_size = context.terminal.size().map_err(to_napi_error)?;
        let vp_height = terminal_size.height.saturating_sub(3).max(1);

        let mut state = context.state.lock().map_err(to_napi_error)?;

        // Store viewport_height and adjust scroll
        context.viewport_height.store(vp_height, Ordering::Relaxed);
        state.adjust_scroll(vp_height);

        let scroll_top = state.scroll_top;
        let cursor_row = state.cursor_row;
        let cursor_col = state.cursor_col;
        let anchor_row = state.anchor_row;
        let anchor_col = state.anchor_col;
        let visual_mode = state.visual_mode;
        let demo_text: Vec<String> = state.demo_text.clone();
        let highlights = state.highlights.clone();
        let selections = state.selections.clone();
        let status_text = state.status_text.clone();
        (
            cursor_row,
            cursor_col,
            anchor_row,
            anchor_col,
            visual_mode,
            demo_text,
            highlights,
            selections,
            status_text,
            scroll_top,
            vp_height,
        )
    };

    // Phase 2: Line-building phase (outside locks)
    let total_lines = demo_text.len() as u16;
    let visible_end = (scroll_top + viewport_height).min(total_lines);
    let visible_lines: Vec<String> = demo_text[scroll_top as usize..visible_end as usize].to_vec();

    let selection_active = visual_mode != VisualMode::None;
    let (sel_start_row, _, sel_end_row, _) =
        TuiState::ordered_range(anchor_row, anchor_col, cursor_row, cursor_col);

    let lines: Vec<Line> = visible_lines
        .iter()
        .enumerate()
        .map(|(idx, line)| {
            // scroll_top is clamped by adjust_scroll, so scroll_top + idx <= max_rows
            let row = (scroll_top as usize + idx) as u16;
            let mut row_highlights: Vec<(u16, u16)> = highlights
                .iter()
                .filter(|range| range.start_line == row as u32 && range.end_line == row as u32)
                .map(|range| (range.start_ch as u16, range.end_ch as u16))
                .collect();

            if selection_active {
                let row_index = row;
                let line_len = line.chars().count() as u16;
                let highlight_width = line_len.max(1);
                let selection_range = match visual_mode {
                    VisualMode::None => None,
                    VisualMode::Char => selections.first().and_then(|selection| {
                        let start_line = selection.anchor_line.min(selection.head_line) as u16;
                        let end_line = selection.anchor_line.max(selection.head_line) as u16;
                        let start_col = selection.anchor_ch.min(selection.head_ch) as u16;
                        let end_col = selection.anchor_ch.max(selection.head_ch) as u16;

                        if start_line == end_line {
                            (row_index == start_line)
                                .then_some((start_col.min(line_len), end_col.min(highlight_width)))
                        } else if row_index == start_line {
                            Some((start_col.min(line_len), line_len))
                        } else if row_index == end_line {
                            Some((0, end_col.min(highlight_width)))
                        } else if row_index > start_line && row_index < end_line {
                            Some((0, highlight_width))
                        } else {
                            None
                        }
                    }),
                    VisualMode::Line => (row_index >= sel_start_row && row_index <= sel_end_row)
                        .then_some((0, highlight_width)),
                    VisualMode::Block => {
                        if row_index >= sel_start_row && row_index <= sel_end_row {
                            let start = anchor_col.min(cursor_col);
                            let end = anchor_col.max(cursor_col) + 1;
                            Some((start, end))
                        } else {
                            None
                        }
                    }
                };

                if let Some((start, end)) = selection_range.filter(|(start, end)| start < end) {
                    row_highlights.push((start, end));
                }
            }

            if !row_highlights.is_empty() {
                build_highlighted_line(line, &row_highlights)
            } else {
                Line::from(line.as_str())
            }
        })
        .collect();

    // Phase 3: Draw phase - inside outer TUI_CONTEXT Mutex lock
    let mut ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx
        .as_mut()
        .ok_or_else(|| to_napi_error("TUI not initialized"))?;

    context
        .terminal
        .draw(|f| {
            let size = f.area();
            let layout = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]);
            let [editor_area, status_area] = layout.areas(size);

            let block = Block::default().borders(Borders::ALL).title("ReVim");
            let paragraph = Paragraph::new(lines)
                .block(block.clone())
                .alignment(Alignment::Left);
            // Only render editor if it has positive height/width
            if editor_area.height > 0 && editor_area.width > 0 {
                f.render_widget(paragraph, editor_area);
                let inner_area = block.inner(editor_area);
                // Compute cursor position relative to viewport
                let cursor_row_in_viewport = cursor_row.saturating_sub(scroll_top);
                let cx = inner_area
                    .x
                    .saturating_add(cursor_col.min(inner_area.width.saturating_sub(1)));
                let cy = inner_area.y.saturating_add(
                    cursor_row_in_viewport.min(inner_area.height.saturating_sub(1)),
                );
                f.set_cursor_position((cx, cy));
            }

            let status_bar = Paragraph::new(status_text.as_str()).alignment(Alignment::Left);
            f.render_widget(status_bar, status_area);
        })
        .map_err(to_napi_error)?;

    Ok(())
}
