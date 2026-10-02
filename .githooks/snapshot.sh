# Sourced by the hooks: copy what's staged to a fixed dir in .git and cd
# there, so the checks see the commit, not the working tree, and never write
# to it. The path is fixed so tsc's incremental cache stays valid between runs.
# node_modules is untracked, so the copy links to the working tree's.
repo=$(git rev-parse --show-toplevel)
cd "$repo"
git_dir=$(git rev-parse --absolute-git-dir)
snapshot="$git_dir/pre-commit-tree"
rm -rf "$snapshot"
git checkout-index --all --prefix="$snapshot/"
ln -s "$repo/node_modules" "$snapshot/node_modules"
cd "$snapshot"
