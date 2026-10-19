/**
 * The "active" treatment shared by the toggle buttons that light up while their feature is on: the
 * icon takes the theme accent and the short underline bar (the button's ::after) becomes visible.
 * Used by the analysis-view toggle, the mute toggle, and the analysis-panel toggle in the title
 * bar — the class string must stay character-identical everywhere.
 */
export const TOGGLE_ACTIVE_BAR = 'text-dark-background-color-3! after:opacity-100';
