import { describe, expect, it } from "vitest";
import { reviewTransaction } from "./device";

const base = {
  TransactionType: "SigningSessionSet",
  Account: "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK",
  Fee: "12",
  SessionKey: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
  SessionDuration: 600,
};

describe("SIMULATED device review of SigningSessionSet", () => {
  it("states what a capped session may sign, then the note, as the app does", () => {
    const review = reviewTransaction({ ...base, SessionCap: "20000000" });
    expect(review.lines.slice(-3).map((line) => line.label)).toEqual([
      "Max spend",
      "Allows",
      "Note",
    ]);
    expect(review.lines.slice(-2)).toEqual([
      { label: "Allows", value: "XRP payments only, fees included" },
      { label: "Note", value: "Cannot change keys or signers" },
    ]);
  });

  it("does not add the mode C row to a mode A session", () => {
    const review = reviewTransaction({ ...base, Flags: 0x00010000 });
    expect(review.lines.filter((line) => line.label === "Allows")).toEqual([
      { label: "Allows", value: "All transactions" },
    ]);
  });
});
