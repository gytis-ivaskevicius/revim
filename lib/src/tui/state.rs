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

// Note: Undo/redo is implemented in TypeScript using snapshot-based approach.
// See app/src/vim/adapter.ts for the implementation.

pub struct TuiState {
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub anchor_row: u16,
    pub anchor_col: u16,
    pub visual_mode: VisualMode,
    pub demo_text: Vec<String>,
    pub selections: Vec<Selection>,
    pub highlights: Vec<HighlightRange>,
    pub status_text: String,
    pub scroll_top: u16,
}

impl Default for TuiState {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiState {
    pub fn new() -> Self {
        let demo_text = vec![
            "Welcome to ReVim!".to_string(),
            "This is a line of text.".to_string(),
            "ReVim is a terminal-based text editor.".to_string(),
            "It mimics the behavior of Vim.".to_string(),
            "".to_string(),
            "Basic movement keys:".to_string(),
            "  h - move left".to_string(),
            "  j - move down".to_string(),
            "  k - move up".to_string(),
            "  l - move right".to_string(),
            "".to_string(),
            "Word motion:".to_string(),
            "  w - next word".to_string(),
            "  b - previous word".to_string(),
            "  e - end of word".to_string(),
            "".to_string(),
            "Line numbers are not shown yet.".to_string(),
            "Visual mode selection works.".to_string(),
            "You can delete, yank, and put text.".to_string(),
            "".to_string(),
            "Insert mode:".to_string(),
            "  i - insert before cursor".to_string(),
            "  a - insert after cursor".to_string(),
            "  A - append at line end".to_string(),
            "  o - open new line below".to_string(),
            "  O - open new line above".to_string(),
            "".to_string(),
            "To exit ReVim:".to_string(),
            "  Press Ctrl+C to quit".to_string(),
            "".to_string(),
            "Sentence motions:".to_string(),
            "  ( - go to previous sentence".to_string(),
            "  ) - go to next sentence".to_string(),
            "  { - go to previous paragraph".to_string(),
            "  } - go to next paragraph".to_string(),
            "".to_string(),
            "This buffer has 42 lines total.".to_string(),
            "Scrolling is now supported!".to_string(),
            "The viewport shows 27 lines.".to_string(),
            "Use ArrowDown to scroll down.".to_string(),
            "When cursor moves past viewport,".to_string(),
            "the view automatically scrolls.".to_string(),
            "".to_string(),
            "Press G to jump to last line.".to_string(),
            "Press gg to return to first line.".to_string(),
            "".to_string(),
            "End of demo buffer.".to_string(),
        ];
        Self {
            cursor_row: 0,
            cursor_col: 0,
            anchor_row: 0,
            anchor_col: 0,
            visual_mode: VisualMode::None,
            demo_text,
            selections: vec![Selection {
                anchor_line: 0,
                anchor_ch: 0,
                head_line: 0,
                head_ch: 0,
            }],
            highlights: Vec::new(),
            status_text: String::new(),
            scroll_top: 0,
        }
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
        self.demo_text.len() as u16
    }

    pub fn current_line_len(&self) -> u16 {
        self.demo_text
            .get(self.cursor_row as usize)
            .map(|s| s.len() as u16)
            .unwrap_or(0)
            .max(1)
    }

    pub fn get_line(&self, line: u16) -> String {
        self.demo_text
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

    pub fn replace_range(
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

        let _removed = if start_line == end_line {
            start_line_str[start_idx..end_idx].to_string()
        } else {
            let mut result = start_line_str[start_idx..].to_string();
            for i in (start_line + 1)..end_line {
                if let Some(line) = self.demo_text.get(i as usize) {
                    result.push('\n');
                    result.push_str(line);
                }
            }
            result.push('\n');
            result.push_str(&end_line_str[..end_idx]);
            result
        };

        // Note: Undo/redo is implemented in TypeScript using snapshot-based approach.
        // See app/src/vim/adapter.ts for the implementation.

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
            if let Some(text) = self.demo_text.get(i as usize) {
                offset += text.chars().count() as u32 + 1;
            }
        }
        offset + ch as u32
    }

    pub fn pos_from_index(&self, offset: u32) -> (u16, u16) {
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

    pub fn sync_primary_selection(&mut self) {
        self.selections = vec![Selection {
            anchor_line: self.anchor_row as u32,
            anchor_ch: self.anchor_col as u32,
            head_line: self.cursor_row as u32,
            head_ch: self.cursor_col as u32,
        }];
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_state_with_text(line_count: u16) -> TuiState {
        let demo_text: Vec<String> = (0..line_count).map(|i| format!("Line {}", i)).collect();
        TuiState {
            demo_text,
            ..TuiState::default()
        }
    }

    #[test]
    fn adjust_scroll_cursor_at_row_0_vh_27() {
        let mut state = create_state_with_text(50);
        state.cursor_row = 0;
        state.scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.scroll_top, 0);
    }

    #[test]
    fn adjust_scroll_cursor_at_row_26_vh_27() {
        let mut state = create_state_with_text(50);
        state.cursor_row = 26;
        state.scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.scroll_top, 0);
    }

    #[test]
    fn adjust_scroll_cursor_at_row_27_vh_27() {
        let mut state = create_state_with_text(50);
        state.cursor_row = 27;
        state.scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.scroll_top, 1);
    }

    #[test]
    fn adjust_scroll_cursor_at_last_row_vh_27_max_rows_50() {
        let mut state = create_state_with_text(50);
        state.cursor_row = 49;
        state.scroll_top = 0;
        state.adjust_scroll(27);
        assert_eq!(state.scroll_top, 49 - 27 + 1);
    }
}
