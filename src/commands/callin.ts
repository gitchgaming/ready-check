import { makeAttendanceCommand } from "./attendanceCommand.js";

const command = makeAttendanceCommand({
  name: "callin",
  description: "Mark yourself back in for a future raid date without using the schedule message.",
  status: "IN",
  forOthers: false,
});

export const data = command.data;
export const autocomplete = command.autocomplete;
export const execute = command.execute;
