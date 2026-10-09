export const isMacOS = /Mac/i.test(navigator.platform);
export const shortcutModifier = isMacOS ? "⌘" : "Ctrl";

export function hasPrimaryModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
  return isMacOS ? event.metaKey : event.ctrlKey;
}
