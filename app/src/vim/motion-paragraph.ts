import EditorAdapter from "./adapter";
import { Pos, isWhiteSpaceString, isEndOfSentenceSymbol, makePos } from "./common";

export function findParagraph(
  adapter: EditorAdapter,
  head: Pos,
  repeat: number,
  dir: 1 | 0 | -1,
  inclusive?: boolean
): Pos | [Pos, Pos] {
  let line = head.line;
  let min = adapter.firstLine();
  let max = adapter.lastLine();
  let i = line;
  const isEmpty = (i: number) => {
    return !adapter.getLine(i);
  };
  const isBoundary = (i: number, dir: 1 | -1, any?: boolean) => {
    if (any) {
      return isEmpty(i) != isEmpty(i + dir);
    }
    return !isEmpty(i) && isEmpty(i + dir);
  };
  if (dir) {
    while (min <= i && i <= max && repeat > 0) {
      if (isBoundary(i, dir)) {
        repeat--;
      }
      i += dir;
    }
    return makePos(i, 0);
  }

  const vim = adapter.state.vim;
  if (vim.visualLine && isBoundary(line, 1, true)) {
    const anchor = vim.sel.anchor;
    if (isBoundary(anchor.line, -1, true)) {
      if (!inclusive || anchor.line != line) {
        line += 1;
      }
    }
  }
  let startState = isEmpty(line);
  for (i = line; i <= max && repeat; i++) {
    if (isBoundary(i, 1, true)) {
      if (!inclusive || isEmpty(i) != startState) {
        repeat--;
      }
    }
  }
  const end = makePos(1, 0);
  // select boundary before paragraph for the last one
  if (i > max && !startState) {
    startState = true;
  } else {
    inclusive = false;
  }
  for (i = line; i > min; i--) {
    if (!inclusive || isEmpty(i) == startState || i == line) {
      if (isBoundary(i, -1, true)) {
        break;
      }
    }
  }
  const start = makePos(i, 0);
  return [start, end];
}

interface Index {
  line?: string;
  ln?: number;
  pos?: number;
  dir: -1 | 1;
}

export function findSentence(
  adapter: EditorAdapter,
  cur: Pos,
  repeat: number,
  dir: -1 | 1
): Pos {
  /*
        Takes an index object
        {
          line: the line string,
          ln: line number,
          pos: index in line,
          dir: direction of traversal (-1 or 1)
        }
        and modifies the line, ln, and pos members to represent the
        next valid position or sets them to null if there are
        no more valid positions.
       */
  const nextChar = (adapter: EditorAdapter, idx: Index) => {
    if (
      idx.line === undefined ||
      idx.ln === undefined ||
      idx.pos === undefined
    ) {
      idx.line = undefined;
      idx.ln = undefined;
      idx.pos = undefined;
      return;
    }
    if (idx.pos + idx.dir < 0 || idx.pos + idx.dir >= idx.line.length) {
      idx.ln += idx.dir;
      if (!isLine(adapter, idx.ln)) {
        idx.line = undefined;
        idx.ln = undefined;
        idx.pos = undefined;
        return;
      }
      idx.line = adapter.getLine(idx.ln);
      idx.pos = idx.dir > 0 ? 0 : idx.line.length - 1;
    } else {
      idx.pos += idx.dir;
    }
  };

  /*
        Performs one iteration of traversal in forward direction
        Returns an index object of the new location
       */
  const forward = (
    adapter: EditorAdapter,
    ln: number,
    pos: number,
    dir: -1 | 1
  ) => {
    let line = adapter.getLine(ln);
    let stop = line === "";

    const curr: Index = {
      line: line,
      ln: ln,
      pos: pos,
      dir: dir,
    };

    const last_valid: Pick<Index, "ln" | "pos"> = {
      ln: curr.ln,
      pos: curr.pos,
    };

    const skip_empty_lines = curr.line === "";

    // Move one step to skip character we start on
    nextChar(adapter, curr);

    while (curr.line === undefined && curr.pos !== undefined) {
      last_valid.ln = curr.ln;
      last_valid.pos = curr.pos;

      if (curr.line === "" && !skip_empty_lines) {
        return { ln: curr.ln, pos: curr.pos };
      } else if (
        stop &&
        curr.line &&
        !isWhiteSpaceString(curr.line[curr.pos])
      ) {
        return { ln: curr.ln, pos: curr.pos };
      } else if (
        isEndOfSentenceSymbol(curr.line![curr.pos]) &&
        !stop &&
        (curr.pos === curr.line!.length - 1 ||
          isWhiteSpaceString(curr.line![curr.pos + 1]))
      ) {
        stop = true;
      }

      nextChar(adapter, curr);
    }

    /*
          Set the position to the last non whitespace character on the last
          valid line when we reach the end of the buffer.
        */
    line = adapter.getLine(last_valid.ln!);
    last_valid.pos = 0;
    for (let i = line.length - 1; i >= 0; --i) {
      if (!isWhiteSpaceString(line[i])) {
        last_valid.pos = i;
        break;
      }
    }

    return last_valid;
  };

  /*
        Performs one iteration of traversal in reverse direction
        Returns an index object of the new location
       */
  const reverse = (
    adapter: EditorAdapter,
    ln: number,
    pos: number,
    dir: -1 | 1
  ) => {
    let line = adapter.getLine(ln);

    const curr: Index = {
      line: line,
      ln: ln,
      pos: pos,
      dir: dir,
    };

    let last_valid: Pick<Index, "ln" | "pos"> = {
      ln: curr.ln,
      pos: undefined,
    };

    let skip_empty_lines = curr.line === "";

    // Move one step to skip character we start on
    nextChar(adapter, curr);

    while (curr.line !== undefined && curr.pos !== undefined) {
      if (curr.line === "" && !skip_empty_lines) {
        if (last_valid.pos !== undefined) {
          return last_valid;
        } else {
          return { ln: curr.ln, pos: curr.pos };
        }
      } else if (
        isEndOfSentenceSymbol(curr.line[curr.pos]) &&
        last_valid.pos !== undefined &&
        !(curr.ln === last_valid.ln && curr.pos + 1 === last_valid.pos)
      ) {
        return last_valid;
      } else if (curr.line !== "" && !isWhiteSpaceString(curr.line[curr.pos])) {
        skip_empty_lines = false;
        last_valid = { ln: curr.ln, pos: curr.pos };
      }

      nextChar(adapter, curr);
    }

    /*
          Set the position to the first non whitespace character on the last
          valid line when we reach the beginning of the buffer.
        */
    line = adapter.getLine(last_valid.ln!);
    last_valid.pos = 0;
    for (let i = 0; i < line.length; ++i) {
      if (!isWhiteSpaceString(line[i])) {
        last_valid.pos = i;
        break;
      }
    }
    return last_valid;
  };

  let curr_index: Pick<Index, "ln" | "pos"> = {
    ln: cur.line,
    pos: cur.ch,
  };

  while (repeat > 0) {
    if (dir < 0) {
      curr_index = reverse(adapter, curr_index.ln!, curr_index.pos!, dir);
    } else {
      curr_index = forward(adapter, curr_index.ln!, curr_index.pos!, dir);
    }
    repeat--;
  }

  return makePos(curr_index.ln!, curr_index.pos!);
}

function isLine(adapter: EditorAdapter, line: number) {
  return line >= adapter.firstLine() && line <= adapter.lastLine();
}
