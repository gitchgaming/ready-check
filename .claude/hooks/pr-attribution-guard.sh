#!/usr/bin/env bash
# PreToolUse guard for GitHub tools: refuse a PR, comment or review that
# credits someone by display name ("_Requested by **Name** · ..."). The owner's
# name must never reach GitHub; the attribution line credits the login only.
if grep -q 'Requested by \*\*'; then
  echo 'Blocked: the attribution line names a person. Write "_Requested by @<github login> · [project thread](...)_" instead (keep the marker comment line), and never put the owner'"'"'s name in GitHub content.' >&2
  exit 2
fi
exit 0
