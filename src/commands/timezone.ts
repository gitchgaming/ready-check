import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { DateTime } from "luxon";
import { respondFiltered, timezoneChoices } from "../lib/pickers.js";
import { zoneGenericName } from "../lib/time.js";
import { clearUserTimezone, setUserTimezone, userTimezone } from "../lib/userSettings.js";

/** The `zone` value that clears a raider's timezone, so plain-text dates go back to team time. */
export const RESET_ZONE = "reset";

export const data = new SlashCommandBuilder()
  .setName("timezone")
  .setDescription("Privately set your timezone, so raid times in pickers and dropdowns show in it.")
  .addStringOption((opt) =>
    opt.setName("zone").setDescription("Your timezone; leave it out to see your current one").setRequired(false).setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await respondFiltered(
    interaction,
    [{ name: "Use each team's timezone (clear mine)", value: RESET_ZONE }, ...timezoneChoices()],
    "No matching timezone",
  );
}

/** "Central Time (America/Chicago), where it's 7:14 PM now", so a wrong pick is obvious against their own clock. */
function describe(zone: string): string {
  return `**${zoneGenericName(zone)}** (${zone}), where it's ${DateTime.now().setZone(zone).toFormat("h:mm a")} now`;
}

const TEAM_TIME = "pickers and dropdowns show each raid in its team's timezone, with the zone's name (like CDT)";

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  const userId = interaction.user.id;
  const zone = interaction.options.getString("zone")?.trim();
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!zone) {
    const current = await userTimezone(userId);
    await reply(
      current
        ? `🕒 Your timezone is ${describe(current)}. Raid times in pickers and dropdowns show in it. ` +
            "Change it with `/timezone zone:`, or pick \"Use each team's timezone\" there to clear it."
        : `🕒 You haven't set a timezone, so ${TEAM_TIME}. Set yours with \`/timezone zone:\`.`,
    );
    return;
  }

  if (zone === RESET_ZONE) {
    await clearUserTimezone(userId);
    await reply(`✅ Cleared your timezone. Now ${TEAM_TIME}.`);
    return;
  }

  if (!DateTime.now().setZone(zone).isValid) {
    await reply(`"${zone}" isn't a recognized timezone. Pick one from the suggestions as you type.`);
    return;
  }

  await setUserTimezone(userId, zone);
  await reply(
    `✅ Your timezone is now ${describe(zone)}. Raid times in pickers and dropdowns will show in it. ` +
      "Dates in messages already follow your device's clock.",
  );
}
