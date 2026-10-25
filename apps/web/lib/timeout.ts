/** How long the page waits for a node before it gives up. */
export const NODE_TIMEOUT_MS = 8000;

/** `work`, or an error naming `what` when it takes longer than `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not answer within ${ms / 1000} s`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
