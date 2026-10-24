import { reactive } from "vue";
import type { DeviceApprover, DeviceReview } from "./ports";

/**
 * The screen of the (simulated) device, as UI state. The simulated device calls
 * `approver`, which shows the review and resolves when the person presses a button.
 * The live device (M2+) shows its review on the real Stax and does not use this.
 */
export interface DevicePrompt {
  review: DeviceReview | null;
  approver: DeviceApprover;
  answer(approved: boolean): void;
}

export function createDevicePrompt(): DevicePrompt {
  let pending: ((approved: boolean) => void) | null = null;
  // Reviews are shown one at a time: a second request waits for the answer to the first, instead
  // of replacing it and leaving the first caller waiting for ever.
  let queue: Promise<unknown> = Promise.resolve();
  const ask = (review: DeviceReview) =>
    new Promise<boolean>((resolve) => {
      prompt.review = review;
      pending = resolve;
    });
  const prompt: DevicePrompt = reactive({
    review: null,
    approver: (review: DeviceReview) => {
      const turn = queue.then(() => ask(review));
      queue = turn.catch(() => undefined);
      return turn;
    },
    answer(approved: boolean) {
      const resolve = pending;
      pending = null;
      prompt.review = null;
      resolve?.(approved);
    },
  });
  return prompt;
}
