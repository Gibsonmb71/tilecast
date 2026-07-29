const playerPackage = require("./package.json");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "org.tilecast.player",
  productName: "Tilecast Player",
  extraMetadata: {
    version: playerPackage.version,
  },
  // The legacy AppImage toolset dynamically loads libfuse.so.2 before the
  // Electron process can start. The static runtime carries its own mount
  // support, so modern Linux hosts do not need a FUSE 2 compatibility package.
  toolsets: {
    appimage: "1.0.3",
  },
  files: ["dist/**", "static/**"],
  linux: {
    target: ["AppImage"],
    category: "AudioVideo",
    executableName: "tilecast-player",
    artifactName: "tilecast-player-${version}.${ext}",
  },
};
