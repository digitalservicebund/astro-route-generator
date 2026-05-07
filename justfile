# Preview changelog for unreleased changes
changelog:
    git-cliff --unreleased

# Bump version, update changelog, commit, and tag
release:
    #!/usr/bin/env bash
    set -e
    VERSION=$(RUST_LOG=error git-cliff --bumped-version)
    pnpm version "${VERSION#v}" --no-git-tag-version
    git-cliff --bump -o CHANGELOG.md
    git commit -am "chore(release): $VERSION"
    git tag "$VERSION" -m "Release $VERSION"
    bold() { printf "\033[1m%s\033[0m" "$*"; }
    echo
    echo -e "Successfully bumped to $(bold $VERSION)"
    echo
    echo -e "run $(bold 'git push origin main --follow-tags') to publish"
