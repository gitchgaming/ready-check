import { makeAttendanceCommand } from "./attendanceCommand.js";

const command = makeAttendanceCommand({
  name: "callout-for",
  description: "Officers: call out a raider for a future raid date.",
  status: "OUT",
  forOthers: true,
});

export const data = command.data;
export const autocomplete = command.autocomplete;
export const execute = command.execute;
