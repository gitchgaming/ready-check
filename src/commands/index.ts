import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import * as callout from "./callout.js";
import * as raidlead from "./raidlead/index.js";
import * as schedule from "./schedule.js";

export interface Command {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands: Command[] = [callout, schedule, raidlead];
