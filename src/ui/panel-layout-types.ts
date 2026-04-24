export interface PanelSplitSizes {
  imagePanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
}

export interface PanelCollapseState {
  imagePanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;
}

export interface StoredPanelSplitState extends Partial<PanelSplitSizes> {
  imagePanelCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
  bottomPanelCollapsed?: boolean;
}

export interface PanelSplitMetrics {
  mainWidth: number;
  mainHeight: number;
  imagePanelTabWidth: number;
  imageResizerWidth: number;
  rightPanelTabWidth: number;
  rightResizerWidth: number;
  bottomPanelTabHeight: number;
  bottomResizerHeight: number;
}

export type PanelSplitSizeKey = keyof PanelSplitSizes;

export type PanelSplitKeyboardAction =
  | { type: 'delta'; delta: number }
  | { type: 'snap'; target: 'min' | 'max' };
