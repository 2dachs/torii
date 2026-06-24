export interface ComposerKeyState {
  key: string;
  shiftKey: boolean;
  nativeIsComposing?: boolean;
  keyCode?: number;
}

export function shouldSubmitComposer(state: ComposerKeyState): boolean {
  return (
    state.key === 'Enter' &&
    !state.shiftKey &&
    state.nativeIsComposing !== true &&
    state.keyCode !== 229
  );
}
