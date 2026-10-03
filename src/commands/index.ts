import type { ChatInputCommandInteraction, Client } from "discord.js";
import * as raidSetup from "./raidSetup.js";
import * as raidSlot from "./raidSlot.js";
import * as raidStatus from "./raidStatus.js";

export interface Command {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;
}

export const commands: Command[] = [raidSetup, raidSlot, raidStatus];
