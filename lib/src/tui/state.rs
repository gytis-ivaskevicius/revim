use napi_derive::napi;

#[derive(Clone)]
#[napi(object)]
pub struct Selection {
    pub anchor_line: u32,
    pub anchor_ch: u32,
    pub head_line: u32,
    pub head_ch: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum VisualMode {
    None,
    Char,
    Line,
    Block,
}

#[derive(Clone)]
#[napi(object)]
pub struct HighlightRange {
    pub start_line: u32,
    pub start_ch: u32,
    pub end_line: u32,
    pub end_ch: u32,
}

#[derive(Clone)]
pub struct BufferSnapshot {
    pub lines: Vec<String>,
    pub cursor_row: u16,
    pub cursor_col: u16,
}

#[derive(Clone)]
pub struct BufferState {
    pub lines: Vec<String>,
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub anchor_row: u16,
    pub anchor_col: u16,
    pub scroll_top: u16,
    pub current_path: Option<String>,
    pub undo_stack: Vec<BufferSnapshot>,
    pub redo_stack: Vec<BufferSnapshot>,
}

impl Default for BufferState {
    fn default() -> Self {
        Self::new()
    }
}

impl BufferState {
    pub fn new() -> Self {
        Self {
            lines: vec![String::new()],
            cursor_row: 0,
            cursor_col: 0,
            anchor_row: 0,
            anchor_col: 0,
            scroll_top: 0,
            current_path: None,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn max_rows(&self) -> u16 {
        self.lines.len() as u16
    }

    pub fn max_scroll_top(&self, viewport_height: u16) -> u16 {
        self.max_rows().saturating_sub(viewport_height)
    }

    pub fn current_line_len(&self) -> u16 {
        self.lines
            .get(self.cursor_row as usize)
            .map(|s| s.len() as u16)
            .unwrap_or(0)
            .max(1)
    }

    pub fn get_line(&self, line: u16) -> String {
        self.lines
            .get(line as usize)
            .cloned()
            .unwrap_or_default()
    }

    pub fn char_to_byte_index(text: &str, ch: u16) -> usize {
        text.char_indices()
            .nth(ch as usize)
            .map(|(idx, _)| idx)
            .unwrap_or(text.len())
    }

    pub fn get_range(&self, start_line: u16, start_ch: u16, end_line: u16, end_ch: u16) -> String {
        let (start_line, start_ch, end_line, end_ch) =
            TuiState::ordered_range(start_line, start_ch, end_line, end_ch);
        if start_line as usize >= self.lines.len() || end_line as usize >= self.lines.len() {
            return String::new();
        }
        let start_line_str = &self.lines[start_line as usize];
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
            if let Some(line) = self.lines.get(i as usize) {
                result.push('\n');
                result.push_str(line);
            }
        }
        if let Some(end_line_str) = self.lines.get(end_line as usize) {
            result.push('\n');
            let end_ch = end_ch.min(end_line_str.chars().count() as u16);
            let end_idx = Self::char_to_byte_index(end_line_str, end_ch);
            result.push_str(&end_line_str[..end_idx]);
        }
        result
    }

    pub fn replace_range(
        &mut self,
        text: &str,
        start_line: u16,
        start_ch: u16,
        end_line: u16,
        end_ch: u16,
    ) {
        if start_line as usize >= self.lines.len() {
            return;
        }

        let (start_line, start_ch, end_line, end_ch) =
            TuiState::ordered_range(start_line, start_ch, end_line, end_ch);
        if end_line as usize >= self.lines.len() {
            return;
        }

        let start_line_str = self.lines[start_line as usize].clone();
        let end_line_str = self.lines[end_line as usize].clone();
        let start_ch = start_ch.min(start_line_str.chars().count() as u16);
        let end_ch = end_ch.min(end_line_str.chars().count() as u16);
        let start_idx = Self::char_to_byte_index(&start_line_str, start_ch);
        let end_idx = Self::char_to_byte_index(&end_line_str, end_ch);

        let _removed = if start_line == end_line {
            start_line_str[start_idx..end_idx].to_string()
        } else {
            let mut result = start_line_str[start_idx..].to_string();
            for i in (start_line + 1)..end_line {
                if let Some(line) = self.lines.get(i as usize) {
                    result.push('\n');
                    result.push_str(line);
                }
            }
            result.push('\n');
            result.push_str(&end_line_str[..end_idx]);
            result
        };

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

        self.lines
            .splice(start_line as usize..=end_line as usize, new_lines);
    }

    pub fn clip_pos(&self, line: u16, ch: u16) -> (u16, u16) {
        let max_line = self.max_rows().saturating_sub(1);
        let line = line.min(max_line);
        let max_ch = self.get_line(line).chars().count() as u16;
        let ch = ch.min(max_ch);
        (line, ch)
    }

    pub fn index_from_pos(&self, line: u16, ch: u16) -> u32 {
        let mut offset = 0u32;
        for i in 0..line {
            if let Some(text) = self.lines.get(i as usize) {
                offset += text.chars().count() as u32 + 1;
            }
        }
        offset + ch as u32
    }

    pub fn pos_from_index(&self, offset: u32) -> (u16, u16) {
        let mut current_offset = 0u32;
        for (i, line) in self.lines.iter().enumerate() {
            let line_len = line.chars().count() as u32 + 1;
            if current_offset + line_len > offset {
                return (i as u16, (offset - current_offset) as u16);
            }
            current_offset += line_len;
        }

        let last_line = self.max_rows().saturating_sub(1);
        (last_line, self.get_line(last_line).chars().count() as u16)
    }

    pub fn adjust_scroll(&mut self, viewport_height: u16) {
        let max_rows = self.max_rows();
        if self.cursor_row < self.scroll_top {
            self.scroll_top = self.cursor_row;
        } else if self.cursor_row >= self.scroll_top + viewport_height {
            self.scroll_top = self.cursor_row - viewport_height + 1;
        }
        self.scroll_top = self
            .scroll_top
            .min(max_rows.saturating_sub(viewport_height));
    }

    pub fn set_lines(&mut self, lines: Vec<String>) {
        self.lines = lines;
        self.cursor_row = 0;
        self.cursor_col = 0;
        self.anchor_row = 0;
        self.anchor_col = 0;
        self.scroll_top = 0;
        self.undo_stack.clear();
        self.redo_stack.clear();
    }

    pub fn snapshot(&self) -> BufferSnapshot {
        BufferSnapshot {
            lines: self.lines.clone(),
            cursor_row: self.cursor_row,
            cursor_col: self.cursor_col,
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: &BufferSnapshot) {
        self.lines = snapshot.lines.clone();
        self.cursor_row = snapshot.cursor_row;
        self.cursor_col = snapshot.cursor_col;
        self.anchor_row = snapshot.cursor_row;
        self.anchor_col = snapshot.cursor_col;
    }
}

pub struct TuiState {
    pub buffers: Vec<BufferState>,
    pub active: usize,
    // Global (not per-buffer):
    pub visual_mode: VisualMode,
    pub selections: Vec<Selection>,
    pub highlights: Vec<HighlightRange>,
    pub status_text: String,
}

impl Default for TuiState {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiState {
    pub fn new() -> Self {
        Self {
            buffers: vec![BufferState::new()],
            active: 0,
            visual_mode: VisualMode::None,
            selections: vec![Selection {
                anchor_line: 0,
                anchor_ch: 0,
                head_line: 0,
                head_ch: 0,
            }],
            highlights: Vec::new(),
            status_text: String::new(),
        }
    }

    pub fn active(&self) -> &BufferState {
        &self.buffers[self.active]
    }

    pub fn active_mut(&mut self) -> &mut BufferState {
        &mut self.buffers[self.active]
    }

    pub fn set_lines(&mut self, lines: Vec<String>) {
        self.active_mut().set_lines(lines);
        self.visual_mode = VisualMode::None;
        self.sync_primary_selection();
    }

    pub fn ordered_range(
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

    pub fn max_rows(&self) -> u16 {
        self.active().max_rows()
    }

    pub fn max_scroll_top(&self, viewport_height: u16) -> u16 {
        self.active().max_scroll_top(viewport_height)
    }

    pub fn current_line_len(&self) -> u16 {
        self.active().current_line_len()
    }

    pub fn get_line(&self, line: u16) -> String {
        self.active().get_line(line)
    }

    pub fn char_to_byte_index(text: &str, ch: u16) -> usize {
        BufferState::char_to_byte_index(text, ch)
    }

    pub fn get_range(&self, start_line: u16, start_ch: u16, end_line: u16, end_ch: u16) -> String {
        self.active().get_range(start_line, start_ch, end_line, end_ch)
    }

    pub fn replace_range(
        &mut self,
        text: &str,
        start_line: u16,
        start_ch: u16,
        end_line: u16,
        end_ch: u16,
    ) {
        self.active_mut().replace_range(text, start_line, start_ch, end_line, end_ch);
    }

    pub fn clip_pos(&self, line: u16, ch: u16) -> (u16, u16) {
        self.active().clip_pos(line, ch)
    }

    pub fn index_from_pos(&self, line: u16, ch: u16) -> u32 {
        self.active().index_from_pos(line, ch)
    }

    pub fn pos_from_index(&self, offset: u32) -> (u16, u16) {
        self.active().pos_from_index(offset)
    }

    pub fn sync_primary_selection(&mut self) {
        let active = self.active();
        self.selections = vec![Selection {
            anchor_line: active.anchor_row as u32,
            anchor_ch: active.anchor_col as u32,
            head_line: active.cursor_row as u32,
            head_ch: active.cursor_col as u32,
        }];
    }

    pub fn adjust_scroll(&mut self, viewport_height: u16) {
        self.active_mut().adjust_scroll(viewport_height);
    }

    /// Switch to a different buffer. Returns false if index is out of bounds.
    pub fn switch_to(&mut self, index: usize) -> bool {
        if index >= self.buffers.len() {
            return false;
        }
        self.active = index;
        // Reset visual state on switch
        self.visual_mode = VisualMode::None;
        self.highlights.clear();
        self.sync_primary_selection();
        true
    }

    /// Switch to next buffer (wraps around).
    pub fn next_buffer(&mut self) -> usize {
        if self.buffers.len() <= 1 {
            return self.active;
        }
        let next = (self.active + 1) % self.buffers.len();
        self.switch_to(next);
        self.active
    }

    /// Switch to previous buffer (wraps around).
    pub fn prev_buffer(&mut self) -> usize {
        if self.buffers.len() <= 1 {
            return self.active;
        }
        let prev = (self.active + self.buffers.len() - 1) % self.buffers.len();
        self.switch_to(prev);
        self.active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_state_with_text(line_count: u16) -> TuiState {
        let lines: Vec<String> = (0..line_count).map(|i| format!("Line {}", i)).collect();
        TuiState {
            buffers: vec![BufferState {
                lines,
                ..BufferState::new()
            }],
            ..TuiState::default()
        }
    }

    #[test]
    fn current_path_initialized_to_none() {
        let state = TuiState::new();
        assert!(state.active().current_path.is_none());
    }

    #[test]
    fn adjust_scroll_cursor_at_row_0_vh_27() {
        let mut state = create_state_with_text(50);
        state.active_mut().cursor_row = 0;
        state.active_mut().scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.active().scroll_top, 0);
    }

    #[test]
    fn adjust_scroll_cursor_at_row_26_vh_27() {
        let mut state = create_state_with_text(50);
        state.active_mut().cursor_row = 26;
        state.active_mut().scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.active().scroll_top, 0);
    }

    #[test]
    fn adjust_scroll_cursor_at_row_27_vh_27() {
        let mut state = create_state_with_text(50);
        state.active_mut().cursor_row = 27;
        state.active_mut().scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.active().scroll_top, 1);
    }

    #[test]
    fn adjust_scroll_cursor_at_last_row_vh_27_max_rows_50() {
        let mut state = create_state_with_text(50);
        state.active_mut().cursor_row = 49;
        state.active_mut().scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.active().scroll_top, 49 - 27 + 1);
    }

    #[test]
    fn buffer_switch_wraps_around() {
        let mut state = TuiState::new();
        // Add a second buffer
        state.buffers.push(BufferState {
            lines: vec!["Buffer 2".to_string()],
            ..BufferState::new()
        });
        assert_eq!(state.active, 0);

        // next_buffer with 2 buffers
        state.next_buffer();
        assert_eq!(state.active, 1);

        // wrap around
        state.next_buffer();
        assert_eq!(state.active, 0);
    }

    #[test]
    fn buffer_switch_single_is_noop() {
        let mut state = TuiState::new();
        assert_eq!(state.buffers.len(), 1);
        assert_eq!(state.active, 0);

        state.next_buffer();
        assert_eq!(state.active, 0);

        state.prev_buffer();
        assert_eq!(state.active, 0);
    }
}
