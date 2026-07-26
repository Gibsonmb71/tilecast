const playerPackage = require("./package.json");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "org.tilecast.player",
  productName: "Tilecast Player",
  extraMetadata: {
    version: playerPackage.version,
  },
  files: ["dist/**", "static/**"],
  linux: {
    target: ["AppImage"],
    category: "AudioVideo",
    executableName: "tilecast-player",
    artifactName: "tilecast-player-${version}.${ext}",
  },
};
