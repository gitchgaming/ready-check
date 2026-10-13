import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import * as attendance from "./attendance.js";
import * as howitworks from "./howitworks.js";
import * as raidlead from "./raidlead/index.js";
import * as roster from "./roster.js";
import * as schedule from "./schedule.js";
import * as timezone from "./timezone.js";

export interface Command {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands: Command[] = [attendance, schedule, roster, timezone, howitworks, raidlead];
