import type { Disposable } from '../lifecycle';

export function bindDialogBackdropDismiss(
  backdrop: HTMLElement,
  onDismiss: () => void
): Disposable {
  let mousePressStartedOnBackdrop: boolean | null = null;

  const onMouseDown = (event: MouseEvent): void => {
    mousePressStartedOnBackdrop = event.target === backdrop;
  };

  const onClick = (event: MouseEvent): void => {
    if (event.target !== backdrop) {
      mousePressStartedOnBackdrop = null;
      return;
    }

    if (mousePressStartedOnBackdrop === false) {
      mousePressStartedOnBackdrop = null;
      return;
    }

    mousePressStartedOnBackdrop = null;
    onDismiss();
  };

  backdrop.addEventListener('mousedown', onMouseDown);
  backdrop.addEventListener('click', onClick);

  return {
    dispose(): void {
      backdrop.removeEventListener('mousedown', onMouseDown);
      backdrop.removeEventListener('click', onClick);
    }
  };
}
