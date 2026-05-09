use napi::bindgen_prelude::*;
use ratatui::{
    layout::{Alignment, Constraint, Layout},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
};
use std::path::Path;
use std::sync::atomic::Ordering;

use super::state::{TuiState, VisualMode};
use super::{revim_log, to_napi_error, TUI_CONTEXT};

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

/// Build a tab line showing buffer names.
/// Active buffer is highlighted with `Modifier::REVERSED`.
pub fn build_tabs_line(buffer_paths: &[Option<String>], active_index: usize, width: u16) -> Line<'_> {
    let mut spans: Vec<Span> = Vec::new();
    let mut total_len: usize = 0;
    for (i, path) in buffer_paths.iter().enumerate() {
        let basename = path
            .as_ref()
            .and_then(|p| Path::new(p).file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "[No Name]".to_string());
        let label = format!(" {} {} ", i + 1, basename);
        total_len += label.chars().count();
        let span: Span = if i == active_index {
            Span::styled(
                label,
                Style::default().add_modifier(Modifier::REVERSED),
            )
        } else {
            Span::raw(label)
        };
        spans.push(span);
    }
    // Fill remaining width with spaces so the full row is covered
    if total_len < width as usize {
        spans.push(Span::raw(" ".repeat(width as usize - total_len)));
    }
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
        lines,
        highlights,
        selections,
        status_text,
        scroll_top,
        viewport_height,
        buffer_paths,
        active_index,
        show_tabs_bar,
    ) = {
        let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
        let context = ctx
            .as_ref()
            .ok_or_else(|| to_napi_error("TUI not initialized"))?;

        let terminal_size = context.terminal.size().map_err(to_napi_error)?;

        let mut state = context.state.lock().map_err(to_napi_error)?;

        let show_tabs_bar = state.buffers.len() > 1;
        let vp_height = if show_tabs_bar {
            terminal_size.height.saturating_sub(4).max(1)
        } else {
            terminal_size.height.saturating_sub(3).max(1)
        };

        // Store viewport_height and adjust scroll
        context.viewport_height.store(vp_height, Ordering::Relaxed);
        state.adjust_scroll(vp_height);

        let active = state.active();
        let scroll_top = active.scroll_top;
        let cursor_row = active.cursor_row;
        let cursor_col = active.cursor_col;
        let anchor_row = active.anchor_row;
        let anchor_col = active.anchor_col;
        let visual_mode = state.visual_mode;
        let lines: Vec<String> = active.lines.clone();
        let highlights = state.highlights.clone();
        let selections = state.selections.clone();
        let status_text = state.status_text.clone();
        let buffer_paths = state.buffer_paths();
        let active_index = state.active_index();
        (
            cursor_row,
            cursor_col,
            anchor_row,
            anchor_col,
            visual_mode,
            lines,
            highlights,
            selections,
            status_text,
            scroll_top,
            vp_height,
            buffer_paths,
            active_index,
            show_tabs_bar,
        )
    };

    // Phase 2: Line-building phase (outside locks)
    let total_lines = lines.len() as u16;
    let visible_end = (scroll_top + viewport_height).min(total_lines);
    let visible_lines: Vec<String> = lines[scroll_top as usize..visible_end as usize].to_vec();

    let selection_active = visual_mode != VisualMode::None;
    let (sel_start_row, _, sel_end_row, _) =
        TuiState::ordered_range(anchor_row, anchor_col, cursor_row, cursor_col);

    let rendered_lines: Vec<Line> = visible_lines
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

            // Conditional layout: tabs bar appears only when 2+ buffers
            let (tabs_area, editor_area, status_area) = if show_tabs_bar {
                let layout = Layout::vertical([
                    Constraint::Length(1),
                    Constraint::Min(0),
                    Constraint::Length(1),
                ]);
                let [tabs, editor, status] = layout.areas(size);
                (Some(tabs), editor, status)
            } else {
                let layout = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]);
                let [editor, status] = layout.areas(size);
                (None, editor, status)
            };

            // Render tabs bar if visible
            if let Some(tabs_area) = tabs_area {
                let tabs_line = build_tabs_line(&buffer_paths, active_index, tabs_area.width);
                let tabs_bar = Paragraph::new(tabs_line).alignment(Alignment::Left);
                f.render_widget(tabs_bar, tabs_area);
            }

            let block = Block::default().borders(Borders::ALL).title("ReVim");
            let paragraph = Paragraph::new(rendered_lines)
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

            let status_bar = Paragraph::new(status_text.as_str())
                .alignment(Alignment::Left)
                .style(Style::default().add_modifier(Modifier::REVERSED));
            f.render_widget(status_bar, status_area);
        })
        .map_err(to_napi_error)?;

    revim_log!("render_frame_internal: rendered");
    Ok(())
}
