// [RESEARCH-1259] never merged. A release APK refuses plain HTTP, and the soak posts to the runner's collector.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
