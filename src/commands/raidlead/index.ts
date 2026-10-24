import {
  ChannelType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandRoleOption,
  type SlashCommandStringOption,
  MessageFlags,
} from "discord.js";
import { OFFICER_PERMISSION, isOfficer } from "../../lib/access.js";
import { raidDateAutocomplete, setAttendance } from "../../lib/attendance.js";
import { DEFAULT_RAID_SIZE, RAID_SIZES } from "../../lib/classes.js";
import { MAX_COMING_UP } from "../../lib/embeds.js";
import {
  NO_CHOICE,
  dateChoice,
  nightChoices,
  parseTypedDate,
  raidDayChoices,
  respondFiltered,
  MAX_CHOICES,
  fitChoiceName,
  teamDisplayName,
  viewableTeams,
  cancelChoices,
  removeChoices,
  timeChoices,
  timezoneChoices,
  upcomingDateChoices,
} from "../../lib/pickers.js";
import { WEEKDAY_CHOICES } from "../../lib/weekdays.js";
import { userTimezone } from "../../lib/userSettings.js";
import { MAX_NAME_LENGTH, nameChoices } from "../../lib/raiderNames.js";
import * as names from "./names.js";
import * as nights from "./nights.js";
import * as raid from "./raid.js";
import { pickTeam } from "./shared.js";
import * as team from "./team.js";

const roleOption = (opt: SlashCommandRoleOption) =>
  opt.setName("role").setDescription("The role whose members make up the team").setRequired(true);

/** Which team to act on; optional when the server has one team, or the officer is on one. */
const teamOption = (opt: SlashCommandStringOption) =>
  opt.setName("team").setDescription("Only needed if there's more than one raid team").setAutocomplete(true);

const SIZE_CHOICES = RAID_SIZES.map((size) => ({ name: `${size}-player`, value: size }));

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
          .addStringOption((opt) =>
            opt.setName("timezone").setDescription("The team's timezone").setRequired(true).setAutocomplete(true),
          )
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Where the schedule message lives (default: this channel)")
              .addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) => opt.setName("name").setDescription('Display name, e.g. "Main Raid"'))
          .addIntegerOption((opt) =>
            opt
              .setName("coming-up")
              .setDescription("Raids listed under Coming Up, after the next raid (default 3)")
              .setMinValue(0)
              .setMaxValue(MAX_COMING_UP),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("size")
              .setDescription(`Players the raid is built for (default ${DEFAULT_RAID_SIZE})`)
              .addChoices(...SIZE_CHOICES),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("settings")
          .setDescription("See a raid team's settings and weekly nights, or change them")
          .addStringOption((opt) => opt.setName("name").setDescription("Display name"))
          .addStringOption((opt) =>
            opt.setName("timezone").setDescription("The team's timezone (raids stay at the same moment)").setAutocomplete(true),
          )
          .addIntegerOption((opt) =>
            opt.setName("size").setDescription("Players the raid is built for").addChoices(...SIZE_CHOICES),
          )
          .addIntegerOption((opt) =>
            opt
              .setName("coming-up")
              .setDescription("Raids listed under Coming Up, after the next raid")
              .setMinValue(0)
              .setMaxValue(MAX_COMING_UP),
          )
          .addStringOption((opt) =>
            opt
              .setName("final-raid")
              .setDescription("The last raid day (later raids are removed), or clear it")
              .setAutocomplete(true),
          )
          .addStringOption(teamOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("post")
          .setDescription("Post the team's schedule message here or in a channel, replacing the old one")
          .addChannelOption((opt) =>
            opt
              .setName("channel")
              .setDescription("Where to post it (default: this channel)")
              .addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption(teamOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Permanently delete a raid team and its schedule")
          .addStringOption(teamOption),
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
          .addStringOption((opt) =>
            opt.setName("day").setDescription("Day of the week").setRequired(true).addChoices(...WEEKDAY_CHOICES),
          )
          .addStringOption((opt) =>
            opt.setName("time").setDescription("Start time in team time, e.g. 8pm or 20:00").setRequired(true).setAutocomplete(true),
          )
          .addStringOption(teamOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("Change a weekly raid night's start time; its upcoming raids move with it")
          .addStringOption((opt) =>
            opt.setName("night").setDescription("The night to move").setRequired(true).setAutocomplete(true),
          )
          .addStringOption((opt) =>
            opt.setName("time").setDescription("New start time in team time, e.g. 9pm or 21:00").setRequired(true).setAutocomplete(true),
          )
          .addStringOption(teamOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a weekly raid night and its upcoming raids")
          .addStringOption((opt) =>
            opt.setName("night").setDescription("The night to remove").setRequired(true).setAutocomplete(true),
          )
          .addStringOption(teamOption),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("raid")
      .setDescription("Change individual raids on the schedule")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a one-off raid outside the weekly nights")
          .addStringOption((opt) =>
            opt
              .setName("date")
              .setDescription("Pick a date, or type one like 3/15/2027")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((opt) =>
            opt.setName("time").setDescription("Start time in team time, e.g. 8pm or 20:00").setRequired(true).setAutocomplete(true),
          )
          .addStringOption(teamOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("cancel")
          .setDescription("Cancel an upcoming raid, or restore a cancelled one")
          .addStringOption((opt) =>
            opt.setName("date").setDescription("The raid").setRequired(true).setAutocomplete(true),
          )
          .addStringOption(teamOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a one-off raid added by mistake, with its call-outs")
          .addStringOption((opt) =>
            opt.setName("date").setDescription("The one-off raid").setRequired(true).setAutocomplete(true),
          )
          .addStringOption(teamOption),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("attendance")
      .setDescription("Call a raider out of a raid, or switch them back in")
      .addUserOption((opt) => opt.setName("user").setDescription("The raider").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("date").setDescription("The raid").setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("name")
      .setDescription("Set the name a raider shows as on a team, or clear it")
      .addUserOption((opt) => opt.setName("user").setDescription("The raider").setRequired(true))
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("The name to show, like their character's")
          .setRequired(true)
          .setMaxLength(MAX_NAME_LENGTH)
          .setAutocomplete(true),
      )
      .addStringOption(teamOption),
  );

type Handler = (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;

const handlers: Record<string, Handler> = {
  "team setup": team.setup,
  "team settings": team.settings,
  "team post": team.post,
  "team delete": team.remove,
  "nights add": nights.add,
  "nights edit": nights.edit,
  "nights remove": nights.remove,
  "raid add": raid.add,
  "raid cancel": raid.cancel,
  "raid remove": raid.remove,
  attendance: (i, c) => setAttendance(i, c, "TOGGLE", i.options.getUser("user", true).id),
  name: names.set,
};

function routeKey(group: string | null, sub: string): string {
  return group ? `${group} ${sub}` : sub;
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isOfficer(interaction)) {
    await interaction.reply({ content: "Only officers can use /raidlead.", flags: MessageFlags.Ephemeral });
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

  if (key === "attendance") {
    const userId = interaction.options.get("user")?.value as string | undefined;
    await raidDateAutocomplete(interaction, userId, "TOGGLE", undefined, true);
    return;
  }

  if (focused === "name" && key === "name") {
    await interaction.respond(nameChoices(interaction.options.getFocused(), "Use their Discord name (clear it)"));
    return;
  }

  if (focused === "team") {
    const teams = await viewableTeams(interaction.guild, interaction.user.id, true);
    const choices = teams.map((t) => ({ name: fitChoiceName(teamDisplayName(t, interaction.guild)), value: t.id }));
    await respondFiltered(interaction, choices, "No raid teams yet");
    return;
  }

  const pick = await pickTeam(interaction.guild, interaction.user.id, interaction.options.get("team")?.value as string | undefined);
  if (!("team" in pick)) {
    await interaction.respond([{ name: fitChoiceName(pick.problem.replace(/`/g, "")), value: NO_CHOICE }]);
    return;
  }
  const raidTeam = pick.team;

  const viewerZone = await userTimezone(interaction.user.id);
  const zone = viewerZone ?? raidTeam.timezone;
  if (focused === "time") {
    await interaction.respond(timeChoices(interaction.options.getFocused(), raidTeam.timezone));
  } else if (focused === "night") {
    await respondFiltered(interaction, await nightChoices(raidTeam, viewerZone), "No weekly raid nights yet");
  } else if (key === "raid cancel") {
    await respondFiltered(interaction, await cancelChoices(raidTeam, zone), "No upcoming raids");
  } else if (key === "raid remove") {
    await respondFiltered(interaction, await removeChoices(raidTeam, zone), "No upcoming one-off raids");
  } else if (focused === "final-raid") {
    const typed = interaction.options.getFocused();
    const parsed = parseTypedDate(typed, raidTeam.timezone);
    if (parsed) {
      await interaction.respond([dateChoice(parsed)]);
      return;
    }
    // A final raid date is usually a raid's day, so those come first.
    const raidDays = typed ? [] : await raidDayChoices(raidTeam);
    const dates = raidDays.length > 0 ? raidDays : upcomingDateChoices(raidTeam.timezone, typed);
    const clear = raidTeam.finalRaidDate ? [{ name: "No final raid: keep scheduling the weekly nights", value: team.NO_FINAL_RAID }] : [];
    await respondFiltered(interaction, [...clear, ...dates].slice(0, MAX_CHOICES), "No dates available");
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
