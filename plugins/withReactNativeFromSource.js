const { withPodfileProperties } = require("expo/config-plugins");

/** iOS links React Native core prebuilt unless told otherwise, and a prebuilt core carries none of `patches/react-native+*.patch`. */
module.exports = (config) =>
  withPodfileProperties(config, (mod) => {
    mod.modResults["ios.buildReactNativeFromSource"] = "true";
    return mod;
  });
