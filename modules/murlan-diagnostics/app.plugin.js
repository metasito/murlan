const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

module.exports = (config) =>
  process.env.EXPO_PUBLIC_DIAGNOSTICS === "1"
    ? withInfoPlist(
        withAndroidManifest(config, (mod) => {
          mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
          return mod;
        }),
        (mod) => {
          mod.modResults.NSMicrophoneUsageDescription = "The bench records the speaker to time sound onsets.";
          return mod;
        }
      )
    : config;
