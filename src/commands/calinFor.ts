import { makeAttendanceCommand } from "./attendanceCommand.js";

const command = makeAttendanceCommand({
  name: "callin-for",
  description: "Officers: mark a raider back in for a future raid date.",
  status: "IN",
  forOthers: true,
});

export const data = command.data;
export const autocomplete = command.autocomplete;
export const execute = command.execute;
