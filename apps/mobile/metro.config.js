// Metro config for Stelix — keep the watcher inside apps/mobile only.
//
// The repo is a monorepo, and Expo otherwise expands Metro's watch scope
// to the workspace root, which watches the whole tree (contracts, admin,
// keeper, node_modules everywhere). On Android / Termux the inotify cap
// (fs.inotify.max_user_watches, typically 8192) is exhausted and Metro
// crashes with ENOSPC. Limiting watchFolders to this app is the fix.
// EXPO_NO_METRO_WORKSPACE_ROOT=1 does the same thing from the command line.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Only watch this app folder, never the monorepo root.
config.watchFolders = [__dirname];

module.exports = config;
