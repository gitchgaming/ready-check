import { MessageFlags, type Client, type Interaction } from "discord.js";
import { commands, type Command } from "../commands/index.js";
import { isAttendanceControl, handleAttendanceControl } from "./attendanceControls.js";
import { isNavButton, handleNavButton } from "./navButton.js";
import { isTeamDeleteButton, handleTeamDeleteButton } from "./teamDeleteButton.js";

const defaultCommandsByName = new Map(commands.map((c) => [c.data.name, c]));

/** Sends each interaction to its slash command or component handler, by command name or customId prefix. */
export async function routeInteraction(
  interaction: Interaction,
  client: Client,
  commandsByName: ReadonlyMap<string, Command> = defaultCommandsByName,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, client);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction);
      return;
    }

    if ((interaction.isButton() || interaction.isStringSelectMenu()) && isAttendanceControl(interaction.customId)) {
      await handleAttendanceControl(interaction, client);
      return;
    }

    if (interaction.isButton() && isNavButton(interaction.customId)) {
      await handleNavButton(interaction, client);
      return;
    }

    if (interaction.isButton() && isTeamDeleteButton(interaction.customId)) {
      await handleTeamDeleteButton(interaction, client);
      return;
    }
  } catch (err) {
    console.error("Error handling interaction:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
}
