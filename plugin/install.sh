#!/bin/sh
# Installs the pack into one DSH profile — POSIX counterpart of install.ps1.
#
# Since 0.1.1 the pack declares the five components as its own dependencies, and
# DSH profiles install with `nodeLinker: hoisted`, so the components land at the
# profile ROOT — exactly where a bundle row resolves its `name`. Installing the
# pack alone is therefore enough; this script only verifies that, and falls back
# to adding a component explicitly when a profile is not hoisted.
#
# Usage:
#   sh install.sh                 # profile "desktop"
#   DSH_PROFILE=web sh install.sh # another profile
#   DSH_BIN=/path/to/dsh sh install.sh
set -eu

PROFILE="${DSH_PROFILE:-desktop}"
PACK="@funniki/dsh-session-toolkit"
COMPONENTS="@funniki/dsh-session-toolkit-archived-session-delete
@funniki/dsh-session-toolkit-session-move
@funniki/dsh-session-toolkit-unsent-content-guard
@funniki/dsh-session-toolkit-session-history-search
@funniki/dsh-session-toolkit-auto-paste"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -n "${DSH_BIN:-}" ]; then
	dsh="$DSH_BIN"
elif command -v dsh >/dev/null 2>&1; then
	dsh=$(command -v dsh)
else
	printf 'error: the dsh CLI was not found on PATH.\n' >&2
	printf 'Install DeepSeek Harness, or run this script with DSH_BIN=/path/to/dsh.\n' >&2
	exit 1
fi

add() {
	printf 'Adding %s\n' "$1"
	"$dsh" plugin --profile "$PROFILE" add "$1"
}

# The pack: this folder when it is the extracted zip, the registry otherwise.
if [ -f "$script_dir/cordis.patch.yml" ] && [ -f "$script_dir/package.json" ]; then
	add "$script_dir"
else
	add "$PACK"
fi

dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir="$dsh_home/profiles/$PROFILE"
node_modules="$profile_dir/node_modules"

if [ ! -f "$profile_dir/package.json" ]; then
	printf 'error: profile "%s" has no package.json (%s)\n' "$PROFILE" "$profile_dir" >&2
	exit 1
fi

# Did all five rows land where the loader looks for them?
missing=""
for component in $COMPONENTS; do
	if [ ! -d "$node_modules/$component" ]; then
		missing="$missing $component"
	fi
done

# Fallback for a profile that is not using the hoisted linker.
if [ -n "$missing" ]; then
	printf '\nThese components did not arrive with the pack (profile is not hoisted):\n'
	for component in $missing; do printf '  %s\n' "$component"; done
	for component in $missing; do
		add "$component"
	done
fi

# The pack must be registered as a bundle, and no Harness core copy may appear.
if ! grep -q '@funniki/dsh-session-toolkit' "$profile_dir/package.json"; then
	printf 'error: the profile did not record the pack as a bundle.\n' >&2
	exit 1
fi
if [ -e "$node_modules/@deepseek-ai/dsh-tools" ]; then
	printf 'error: duplicate Harness core at %s — remove it before starting DSH.\n' \
		"$node_modules/@deepseek-ai/dsh-tools" >&2
	exit 1
fi

printf '\nInstalled %s and its five components into profile "%s".\n' "$PACK" "$PROFILE"
printf 'Restart DSH, or disable and re-enable the bundle in Plugins if it is already running.\n'
