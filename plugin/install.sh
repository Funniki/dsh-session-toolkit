#!/bin/sh
# Installs the pack into one DSH profile — POSIX counterpart of install.ps1.
#
# Since 0.1.1 the pack declares the five components as its own dependencies, and
# DSH profiles install with `nodeLinker: hoisted`, so the components land at the
# profile ROOT — exactly where a bundle row resolves its `name`.
#
# `dsh plugin add` records an EXACT version, so a profile that still pins one of the
# six at an older version keeps it even though the pack depends on the new one. When
# that is detected, all six are removed first and reinstalled as a set.
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

dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir="$dsh_home/profiles/$PROFILE"
node_modules="$profile_dir/node_modules"
profile_manifest="$profile_dir/package.json"

target_version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$script_dir/package.json" | head -1)

# 0. Stale-version cleanup: an exact pinned component would survive the reinstall.
stale=""
if [ -f "$profile_manifest" ]; then
	for name in "$PACK" $COMPONENTS; do
		declared=$(sed -n "s|^[[:space:]]*\"$name\":[[:space:]]*\"\([^\"]*\)\".*|\1|p" "$profile_manifest" | head -1)
		if [ -n "$declared" ] && [ "$declared" != "$target_version" ]; then
			stale="$stale $name"
		fi
	done
fi
if [ -n "$stale" ]; then
	printf '\nProfile pins these at another version; removing all six first:\n'
	for name in $stale; do printf '  %s\n' "$name"; done
	"$dsh" plugin --profile "$PROFILE" remove $PACK $COMPONENTS
fi

# The pack: this folder when it is the extracted zip, the registry otherwise.
if [ -f "$script_dir/cordis.patch.yml" ] && [ -f "$script_dir/package.json" ]; then
	add "$script_dir"
else
	add "$PACK"
fi

# The five components are always installed explicitly: a `link:` install does not pull
# the linked package's dependencies, so the pack alone leaves the rows unloadable.
for component in $COMPONENTS; do
	bundled="$script_dir/node_modules/$component"
	if [ -f "$bundled/package.json" ]; then
		add "$bundled"
	else
		add "$component"
	fi
done

# Every row must be resolvable from the profile root (that is where the loader looks).
for component in $COMPONENTS; do
	if [ ! -d "$node_modules/$component" ]; then
		printf 'error: component did not install: %s\n' "$component" >&2
		exit 1
	fi
done

# The pack must be registered as a bundle, and no Harness core copy may appear.
if ! grep -q '@funniki/dsh-session-toolkit' "$profile_manifest"; then
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
