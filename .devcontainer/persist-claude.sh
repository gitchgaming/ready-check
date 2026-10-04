#!/bin/sh
# Keep Claude Code's state (login, settings, transcripts, memory) on the
# /workspaces volume so it survives container rebuilds. Lives outside the
# repo folder so credentials are never committed.
set -e
STATE=/workspaces/.claude-state
mkdir -p "$STATE"
[ -L "$HOME/.claude" ] || { rm -rf "$HOME/.claude"; ln -s "$STATE" "$HOME/.claude"; }
[ -L "$HOME/.claude.json" ] || { rm -f "$HOME/.claude.json"; ln -s "$STATE/.claude.json" "$HOME/.claude.json"; }
