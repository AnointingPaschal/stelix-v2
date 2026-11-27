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

// Circle SDK: NEVER bundle @circle-fin/w3s-pw-react-native-sdk in
// Expo Go. Its JS calls requireNativeModule('ProgrammablewalletRnSdk')
// at module load, Metro preloads bundled modules, and Expo Go does
// not ship that native module — the app crashed on launch with
// "Cannot find native module 'ProgrammablewalletRnSdk'" (2026-11-27).
// The package is uninstalled and loadCircleSdk() in src/lib/circle.ts
// is a stub that never imports it; this blockList is the second line
// of defence so a stray import can never re-enter the bundle.
// Circle is EAS-build only; re-add the package + plugins for that
// build, never for Expo Go.
config.resolver = {
  ...config.resolver,
  blockList: [/node_modules\/@circle-fin\/w3s-pw-react-native-sdk\/.*/],
};

module.exports = config;
