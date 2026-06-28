export const gameEvents = new EventTarget();

export function emitGameEvent<T>(name: string, detail: T): void {
  gameEvents.dispatchEvent(new CustomEvent(name, { detail }));
}
