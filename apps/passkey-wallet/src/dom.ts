export function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`missing element #${id}`);
  return found;
}

/** Runs an async click handler, logs its error, then refreshes the page state. */
export function guarded(
  action: () => Promise<void>,
  onError: (error: unknown) => void,
  after: () => Promise<void>,
): () => void {
  return () => {
    action()
      .catch(onError)
      .finally(() => void after().catch(onError));
  };
}
