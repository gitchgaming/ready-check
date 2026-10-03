import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import * as access from "./access.js";
import * as callin from "./callin.js";
import * as calinFor from "./calinFor.js";
import * as callout from "./callout.js";
import * as calloutFor from "./calloutFor.js";
import * as raidCalendar from "./raidCalendar.js";
import * as raidCancel from "./raidCancel.js";
import * as raidExtra from "./raidExtra.js";
import * as raidPublish from "./raidPublish.js";
import * as raidUncancel from "./raidUncancel.js";
import * as raidRoster from "./raidRoster.js";
import * as raidSetup from "./raidSetup.js";
import * as raidSlot from "./raidSlot.js";
import * as raidStatus from "./raidStatus.js";

export interface Command {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands: Command[] = [
  access,
  raidSetup,
  raidSlot,
  raidStatus,
  raidCalendar,
  raidRoster,
  raidPublish,
  raidCancel,
  raidUncancel,
  raidExtra,
  callout,
  callin,
  calloutFor,
  calinFor,
];
