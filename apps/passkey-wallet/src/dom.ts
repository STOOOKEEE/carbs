export function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`missing element #${id}`);
  return found;
}

/** The button the user pressed: the clicked one, or the one that submitted the form. */
function pressedButton(event: Event | undefined): HTMLButtonElement | undefined {
  if (event instanceof SubmitEvent)
    return event.submitter instanceof HTMLButtonElement ? event.submitter : undefined;
  return event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : undefined;
}

/**
 * A click or submit handler around an async action: logs its error, then refreshes the page
 * state. One run at a time: the pressed button stays disabled and further clicks are ignored
 * until the action and the refresh end, so a double click cannot sign and submit the same
 * transaction (same Sequence) twice. The action starts inside the event, with no await before
 * it: WebHID's device chooser needs the click's user activation.
 */
export function guarded(
  action: () => Promise<void>,
  onError: (error: unknown) => void,
  after: () => Promise<void>,
): (event?: Event) => void {
  let running = false;
  return (event) => {
    if (event?.type === "submit") event.preventDefault();
    if (running) return;
    running = true;
    const button = pressedButton(event);
    if (button !== undefined) button.disabled = true;
    action()
      .catch(onError)
      .finally(() => {
        // Re-enabled before the refresh, which then sets the button's real state.
        if (button !== undefined) button.disabled = false;
        return after().catch(onError);
      })
      .finally(() => {
        running = false;
      });
  };
}
