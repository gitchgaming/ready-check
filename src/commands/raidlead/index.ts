import {
  ChannelType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandRoleOption,
} from "discord.js";
import { OFFICER_PERMISSION, isOfficer } from "../../lib/access.js";
import { raidDateAutocomplete, setAttendance } from "../../lib/attendance.js";
import { MAX_PUBLIC_DAYS } from "../../lib/embeds.js";
import {
  NO_CHOICE,
  dateChoice,
  nightChoices,
  parseTypedDate,
  oneOffRaidChoices,
  respondFiltered,
  teamFromRoleOption,
  teamRaidChoices,
  timezoneChoices,
  upcomingDateChoices,
} from "../../lib/pickers.js";
import { WEEKDAY_CHOICES } from "../../lib/weekdays.js";
import * as nights from "./nights.js";
import * as raid from "./raid.js";
import * as team from "./team.js";

const roleOption = (opt: SlashCommandRoleOption) =>
  opt.setName("role").setDescription("The raid team's role").setRequired(true);

export const data = new SlashCommandBuilder()
  .setName("raidlead")
  .setDescription("Officer tools for running raid teams.")
  .setDefaultMemberPermissions(OFFICER_PERMISSION)
  .addSubcommandGroup((group) =>
    group
      .setName("team")
      .setDescription("Create and manage raid teams")
      .addSubcommand((sub) =>
        sub
          .setName("setup")
          .setDescription("Create a raid team for a role")
          .addRoleOption(roleOption)
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Where the schedule message lives")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addStringOption((opt) =>
            opt.setName("timezone").setDescription("The team's timezone").setRequired(true).setAutocomplete(true),
          )
          .addStringOption((opt) => opt.setName("name").setDescription('Display name, e.g. "Main Raid"'))
          .addIntegerOption((opt) =>
            opt
              .setName("raids-shown")
              .setDescription("Upcoming raids on the schedule message (default 3)")
              .setMinValue(1)
              .setMaxValue(MAX_PUBLIC_DAYS),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("Change a raid team's settings")
          .addRoleOption(roleOption)
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Move the schedule message to this channel")
              .addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) =>
            opt.setName("timezone").setDescription("The team's timezone").setAutocomplete(true),
          )
          .addStringOption((opt) => opt.setName("name").setDescription("Display name"))
          .addIntegerOption((opt) =>
            opt
              .setName("raids-shown")
              .setDescription("Upcoming raids on the schedule message")
              .setMinValue(1)
              .setMaxValue(MAX_PUBLIC_DAYS),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("publish")
          .setDescription("Post the team's schedule message in this channel")
          .addRoleOption(roleOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("roster")
          .setDescription("Post an auto-updating roster in this channel")
          .addRoleOption(roleOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Permanently delete a raid team and its schedule")
          .addRoleOption(roleOption),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("nights")
      .setDescription("Weekly recurring raid nights")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a weekly raid night")
          .addRoleOption(roleOption)
          .addStringOption((opt) =>
            opt.setName("day").setDescription("Day of the week").setRequired(true).addChoices(...WEEKDAY_CHOICES),
          )
          .addStringOption((opt) =>
            opt.setName("time").setDescription('Start time, 24-hour, e.g. "20:00"').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a weekly raid night")
          .addRoleOption(roleOption)
          .addStringOption((opt) =>
            opt.setName("night").setDescription("The night to remove").setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("List a team's weekly raid nights").addRoleOption(roleOption),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("raid")
      .setDescription("Change individual raids on the schedule")
      .addSubcommand((sub) =>
        sub
          .setName("cancel")
          .setDescription("Cancel an upcoming raid")
          .addRoleOption(roleOption)
          .addStringOption((opt) =>
            opt.setName("date").setDescription("The raid to cancel").setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("restore")
          .setDescription("Restore a cancelled raid")
          .addRoleOption(roleOption)
          .addStringOption((opt) =>
            opt.setName("date").setDescription("The cancelled raid").setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a one-off raid outside the weekly nights")
          .addRoleOption(roleOption)
          .addStringOption((opt) =>
            opt
              .setName("date")
              .setDescription("Pick a date, or type one like 3/15/2027")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((opt) =>
            opt.setName("time").setDescription('Start time, 24-hour, e.g. "20:00"').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Delete a one-off raid from the schedule")
          .addRoleOption(roleOption)
          .addStringOption((opt) =>
            opt.setName("date").setDescription("The one-off raid").setRequired(true).setAutocomplete(true),
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("callout")
      .setDescription("Call out a raider for a raid")
      .addUserOption((opt) => opt.setName("user").setDescription("The raider").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("date").setDescription("The raid").setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("attend")
      .setDescription("Undo a raider's call-out")
      .addUserOption((opt) => opt.setName("user").setDescription("The raider").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("date").setDescription("The raid").setRequired(true).setAutocomplete(true),
      ),
  );

type Handler = (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;

const handlers: Record<string, Handler> = {
  "team setup": team.setup,
  "team edit": team.edit,
  "team publish": team.publish,
  "team roster": team.roster,
  "team delete": team.remove,
  "nights add": nights.add,
  "nights remove": nights.remove,
  "nights list": nights.list,
  "raid cancel": raid.cancel,
  "raid restore": raid.restore,
  "raid add": raid.add,
  "raid remove": raid.remove,
  callout: (i, c) => setAttendance(i, c, "OUT", i.options.getUser("user", true).id),
  attend: (i, c) => setAttendance(i, c, "IN", i.options.getUser("user", true).id),
};

function routeKey(group: string | null, sub: string): string {
  return group ? `${group} ${sub}` : sub;
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  if (!isOfficer(interaction)) {
    await interaction.reply({ content: "Only officers can use /raidlead.", ephemeral: true });
    return;
  }

  const key = routeKey(interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand());
  await handlers[key]?.(interaction, client);
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild || !isOfficer(interaction)) {
    await interaction.respond([]);
    return;
  }

  const key = routeKey(interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand());
  const focused = interaction.options.getFocused(true).name;

  if (focused === "timezone") {
    await respondFiltered(interaction, timezoneChoices(), "No matching timezone");
    return;
  }

  if (key === "callout" || key === "attend") {
    await raidDateAutocomplete(
      interaction,
      interaction.options.get("user")?.value as string | undefined,
      key === "attend" ? "IN" : "OUT",
    );
    return;
  }

  const raidTeam = await teamFromRoleOption(interaction);
  if (!raidTeam) {
    await interaction.respond([{ name: "Pick a raid team role first", value: NO_CHOICE }]);
    return;
  }

  if (focused === "night") {
    await respondFiltered(interaction, await nightChoices(raidTeam), "No weekly raid nights yet");
  } else if (key === "raid cancel") {
    await respondFiltered(interaction, await teamRaidChoices(raidTeam, false), "No upcoming raids to cancel");
  } else if (key === "raid restore") {
    await respondFiltered(interaction, await teamRaidChoices(raidTeam, true), "No cancelled raids to restore");
  } else if (key === "raid remove") {
    await respondFiltered(interaction, await oneOffRaidChoices(raidTeam), "No upcoming one-off raids");
  } else if (key === "raid add") {
    const typed = interaction.options.getFocused();
    const parsed = parseTypedDate(typed, raidTeam.timezone);
    if (parsed) {
      await interaction.respond([dateChoice(parsed)]);
      return;
    }
    await respondFiltered(interaction, upcomingDateChoices(raidTeam.timezone, typed), "No dates available");
  }
}
