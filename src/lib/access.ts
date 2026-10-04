import { PermissionFlagsBits, type BaseInteraction } from "discord.js";

/** The Discord permission that marks a member as an officer and makes /raidlead visible. */
export const OFFICER_PERMISSION = PermissionFlagsBits.ManageEvents;

/**
 * Officers are the server owner and anyone with Manage Events (Administrator
 * implies it). Discord already hides /raidlead from everyone else, but server
 * admins can override that in Integrations settings, so commands check again.
 */
export function isOfficer(interaction: BaseInteraction): boolean {
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  return interaction.memberPermissions?.has(OFFICER_PERMISSION) ?? false;
}
