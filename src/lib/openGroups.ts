// Remembers which scene groups are expanded. Module-scoped, so it survives navigating away and back
// within the session (the route component remounts and loses local state) without touching the URL.
const open = new Set<string>();

export const isGroupOpen = (key: string): boolean => open.has(key);

export function setGroupOpen(key: string, value: boolean): void {
	if (value) open.add(key);
	else open.delete(key);
}
