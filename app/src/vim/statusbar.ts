type Mode = "normal" | "visual" | "replace" | "insert";
type SubMode = "" | "linewise" | "blockwise";

export interface ModeChangeEvent {
  mode: Mode;
  subMode?: SubMode;
}

export interface StatusBarInputOptions {
  onKeyDown?: (
    evt: any,
    text: string,
    close: (value?: string) => void
  ) => boolean;
  onKeyUp?: (
    evt: any,
    text: string,
    close: (value?: string) => void
  ) => void;
  onClose?: (value: string) => void;
  selectValueOnOpen?: boolean;
  value?: string;
  closeOnBlur?: boolean;
  closeOnEnter?: boolean;
}

export interface IStatusBar {
  toggleVisibility: (visible: boolean) => void;
  showNotification: (message: string) => void;
  setMode: (mode: ModeChangeEvent) => void;
  setKeyBuffer: (key: string) => void;
  startDisplay: (message: string) => () => void;
  startPrompt: (
    prefix: string,
    desc: string,
    options: StatusBarInputOptions
  ) => () => void;
  closeInput: () => void;
  clear: () => void;
}
