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
pub struct HistoryEntry {
    pub start_line: u16,
    pub start_ch: u16,
    pub end_line: u16,
    pub end_ch: u16,
    pub removed: String,
    pub inserted: String,
    pub cursor_before_line: u16,
    pub cursor_before_ch: u16,
    pub cursor_after_line: u16,
    pub cursor_after_ch: u16,
}

pub struct TuiState {
    pub cursor_row: u16,
    pub cursor_col: u16,
    pub anchor_row: u16,
    pub anchor_col: u16,
    pub visual_mode: VisualMode,
    pub demo_text: Vec<String>,
    pub selections: Vec<Selection>,
    pub highlights: Vec<HighlightRange>,
    pub undo_stack: Vec<HistoryEntry>,
    pub redo_stack: Vec<HistoryEntry>,
    pub recording_edit: bool,
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
            visual_mode: VisualMode::None,
            demo_text,
            selections: vec![Selection {
                anchor_line: 0,
                anchor_ch: 0,
                head_line: 0,
                head_ch: 0,
            }],
            highlights: Vec::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            recording_edit: false,
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

        let removed = if start_line == end_line {
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

        let cursor_before_line = self.cursor_row;
        let cursor_before_ch = self.cursor_col;

        let has_change = !removed.is_empty() || !text.is_empty();
        if !self.recording_edit && has_change {
            if !self.recording_edit {
                self.redo_stack.clear();
            }
            let inserted_lines: Vec<&str> = text.split('\n').collect();
            let inserted_end_line = start_line + (inserted_lines.len() as u16).saturating_sub(1);
            let inserted_end_ch = if inserted_lines.len() == 1 {
                start_ch + inserted_lines[0].chars().count() as u16
            } else {
                inserted_lines.last().unwrap_or(&"").chars().count() as u16
            };

            self.undo_stack.push(HistoryEntry {
                start_line,
                start_ch,
                end_line: inserted_end_line,
                end_ch: inserted_end_ch,
                removed,
                inserted: text.to_string(),
                cursor_before_line,
                cursor_before_ch,
                cursor_after_line: self.cursor_row,
                cursor_after_ch: self.cursor_col,
            });
        }

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

    pub fn push_undo_stop(&mut self) {
        self.undo_stack.push(HistoryEntry {
            start_line: 0,
            start_ch: 0,
            end_line: 0,
            end_ch: 0,
            removed: String::new(),
            inserted: String::new(),
            cursor_before_line: self.cursor_row,
            cursor_before_ch: self.cursor_col,
            cursor_after_line: self.cursor_row,
            cursor_after_ch: self.cursor_col,
        });
    }

    pub fn undo(&mut self) -> bool {
        if self.undo_stack.is_empty() {
            return false;
        }

        let mut undone_something = false;

        loop {
            let entry = match self.undo_stack.pop() {
                Some(e) => e,
                None => return undone_something,
            };

            self.redo_stack.push(entry.clone());

            if entry.removed.is_empty() && entry.inserted.is_empty() {
                self.cursor_row = entry.cursor_before_line;
                self.cursor_col = entry.cursor_before_ch;
                if undone_something {
                    break;
                }
                continue;
            }

            self.recording_edit = true;
            let (end_line, end_ch) =
                self.compute_end_position(entry.start_line, entry.start_ch, &entry.inserted);
            self.replace_range(
                &entry.removed,
                entry.start_line,
                entry.start_ch,
                end_line,
                end_ch,
            );
            self.recording_edit = false;

            self.cursor_row = entry.cursor_before_line;
            self.cursor_col = entry.cursor_before_ch;
            undone_something = true;
        }

        self.sync_primary_selection();
        true
    }

    pub fn redo(&mut self) -> bool {
        loop {
            let entry = match self.redo_stack.pop() {
                Some(e) => e,
                None => return false,
            };

            self.undo_stack.push(entry.clone());

            if entry.removed.is_empty() && entry.inserted.is_empty() {
                self.cursor_row = entry.cursor_after_line;
                self.cursor_col = entry.cursor_after_ch;
                continue;
            }

            self.recording_edit = true;
            self.replace_range(
                &entry.inserted,
                entry.start_line,
                entry.start_ch,
                entry.end_line,
                entry.end_ch,
            );
            self.recording_edit = false;

            self.cursor_row = entry.cursor_after_line;
            self.cursor_col = entry.cursor_after_ch;

            break;
        }

        self.sync_primary_selection();
        true
    }

    fn compute_end_position(&self, start_line: u16, start_ch: u16, text: &str) -> (u16, u16) {
        let lines: Vec<&str> = text.split('\n').collect();
        let end_line = start_line + (lines.len() as u16).saturating_sub(1);
        let end_ch = if lines.len() == 1 {
            start_ch + text.chars().count() as u16
        } else {
            lines.last().unwrap_or(&"").chars().count() as u16
        };
        (end_line, end_ch)
    }

    pub fn undo_line(&mut self) -> bool {
        let current_line = self.cursor_row;
        let mut undone_any = false;

        while let Some(entry) = self.undo_stack.pop() {
            if entry.removed.is_empty() && entry.inserted.is_empty() {
                if entry.cursor_after_line == current_line {
                    self.redo_stack.push(entry.clone());
                    self.cursor_row = entry.cursor_before_line;
                    self.cursor_col = entry.cursor_before_ch;
                    continue;
                } else {
                    self.undo_stack.push(entry);
                    break;
                }
            }

            if entry.cursor_after_line != current_line {
                self.undo_stack.push(entry);
                break;
            }

            self.redo_stack.push(entry.clone());

            self.recording_edit = true;
            let (end_line, end_ch) =
                self.compute_end_position(entry.start_line, entry.start_ch, &entry.inserted);
            self.replace_range(
                &entry.removed,
                entry.start_line,
                entry.start_ch,
                end_line,
                end_ch,
            );
            self.recording_edit = false;

            self.cursor_row = entry.cursor_before_line;
            self.cursor_col = entry.cursor_before_ch;
            undone_any = true;
        }

        self.cursor_row = current_line;
        self.sync_primary_selection();
        undone_any
    }
}
