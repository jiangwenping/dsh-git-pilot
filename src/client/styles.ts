/**
 * The plugin's one stylesheet, injected as plugin-owned global styles for the
 * lifetime of the client registration (the module system recovers it on
 * unload/HMR). Every surface class is prefixed `dsh-git-pilot-`; every value
 * rides the host's `--dsw-*` design tokens so light/dark and font-size
 * settings follow the app with zero local constants.
 *
 * Geometry deliberately mirrors the shipped primitives: menu rows copy the
 * shared Menu cell, icon buttons copy the sidebar's 28px toolbar button, the
 * diff reuses the file-diff palette tokens, and the popup card carries the
 * elevation + scrollbar rebinding the shared menu card owns.
 */
export const STYLES = `
.dsh-git-pilot-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 3px 6px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
  max-width: 320px;
  white-space: nowrap;
}
.dsh-git-pilot-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-git-pilot-trigger > svg {
  flex: none;
  width: 14px;
  height: 14px;
}
.dsh-git-pilot-triggerLabel {
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-git-pilot-chevron {
  flex: none;
  display: inline-flex;
  width: 12px;
  height: 12px;
  transition: transform 150ms ease;
}
.dsh-git-pilot-chevron[data-open='true'] {
  transform: rotate(180deg);
}
.dsh-git-pilot-chevron > svg {
  width: 12px;
  height: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-git-pilot-chevron { transition: none; }
}
.dsh-git-pilot-triggerStrong {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dsh-git-pilot-static {
  cursor: default;
}
.dsh-git-pilot-createRow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
}
.dsh-git-pilot-grow {
  flex: 1;
  min-width: 0;
}
.dsh-git-pilot-dirtyPill {
  color: var(--dsw-alias-state-warn-primary);
}

/* The branch menu card: the shared translucent menu material comes from
   MenuSurface; this class adds the card layout, the shared elevation shadow,
   and the elevated-surface scrollbar rebinding. */
.dsh-git-pilot-menu {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 340px;
  max-width: calc(100vw - 24px);
  height: fit-content;
  max-height: min(420px, calc(100vh - 24px));
  padding: 4px;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.dsh-git-pilot-menuViewport {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.dsh-git-pilot-menuSearch {
  flex: none;
  padding: 2px 2px 6px;
}
.dsh-git-pilot-menuSearch > * {
  width: 100%;
}

/* Menu rows: the shared Menu cell (compact variant), token-for-token. */
.dsh-git-pilot-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 30px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}
.dsh-git-pilot-row:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-git-pilot-row:focus-visible:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}
.dsh-git-pilot-row > svg {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-menu-icon);
}
.dsh-git-pilot-rowLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-pilot-rowCreate {
  color: var(--dsw-alias-link, var(--dsw-alias-state-business-primary));
}
.dsh-git-pilot-rowCreate > svg {
  color: inherit;
}
.dsh-git-pilot-confirm {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px;
  padding: 8px;
  border-radius: var(--dsw-radius-md);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
.dsh-git-pilot-confirmText {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dsh-git-pilot-confirmActions {
  display: flex;
  gap: 6px;
}
.dsh-git-pilot-note {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  padding: 6px 8px;
}
.dsh-git-pilot-error {
  flex: none;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
  padding: 4px 8px 2px;
  word-break: break-word;
}

/* The right-Sidebar Changes tab. */
.dsh-git-pilot-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.dsh-git-pilot-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
}
.dsh-git-pilot-totals {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.dsh-git-pilot-added {
  color: var(--dsw-alias-state-success-primary);
}
.dsh-git-pilot-deleted {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-git-pilot-branchLine {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-git-pilot-spring {
  flex: 1;
}
.dsh-git-pilot-iconButton {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  flex: none;
  padding: 0;
}
.dsh-git-pilot-iconButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-git-pilot-iconButton:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dsh-git-pilot-iconButton > svg {
  width: 15px;
  height: 15px;
}
.dsh-git-pilot-list {
  list-style: none;
  margin: 0;
  padding: 2px 8px 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.dsh-git-pilot-fileRow {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: var(--dsw-radius-md);
  padding: 4px 6px;
  cursor: pointer;
}
.dsh-git-pilot-fileRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-git-pilot-fileHead {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.dsh-git-pilot-fileIcon {
  flex: none;
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-git-pilot-fileIcon > svg,
.dsh-git-pilot-fileIcon > svg * {
  width: 16px;
  height: 16px;
}
.dsh-git-pilot-counts {
  flex: none;
  font-size: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dsh-git-pilot-statusSide {
  flex: none;
  font-size: 11px;
  white-space: nowrap;
}
.dsh-git-pilot-commitBar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px 10px;
}
.dsh-git-pilot-commitInput {
  flex: 1;
  min-width: 0;
}
.dsh-git-pilot-confirmStrip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 2px 0 2px 28px;
}
.dsh-git-pilot-confirmStripText {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

/* The per-file diff: the shared file-diff palette (bg/gutter per sign). */
.dsh-git-pilot-diff {
  margin: 2px 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  overflow-x: auto;
  background: var(--dsw-alias-bg-base);
  font: 12px/18px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.dsh-git-pilot-diffLine {
  display: flex;
  white-space: pre;
}
.dsh-git-pilot-diffLine[data-sign='added'] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-file-diff-added-bg);
}
.dsh-git-pilot-diffLine[data-sign='deleted'] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-file-diff-deleted-bg);
}
.dsh-git-pilot-diffLine[data-sign='added'] > .dsh-git-pilot-lineNo {
  background: var(--dsw-alias-file-diff-added-gutter);
}
.dsh-git-pilot-diffLine[data-sign='deleted'] > .dsh-git-pilot-lineNo {
  background: var(--dsw-alias-file-diff-deleted-gutter);
}
.dsh-git-pilot-lineNo {
  flex: none;
  min-width: 36px;
  padding: 0 6px;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
  user-select: none;
}
.dsh-git-pilot-lineText {
  flex: 1;
  padding-right: 8px;
}
.dsh-git-pilot-hunkHead {
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2);
  padding: 0 8px;
}

/* The guide capsule on the sidebar-right start page: the shipped entries'
   geometry, token-for-token (width 380, radius xl, 0.5px l3 stroke, hover). */
.dsh-git-pilot-guideEntry {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 380px;
  max-width: 100%;
  min-height: 56px;
  overflow: hidden;
  padding: 14px 20px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.dsh-git-pilot-guideEntry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-git-pilot-guideIcon {
  flex: none;
  display: flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
}
.dsh-git-pilot-guideText {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.dsh-git-pilot-guideTitle {
  overflow: hidden;
  font-size: 14px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-git-pilot-guideDescription {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}
`
