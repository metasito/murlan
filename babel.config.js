module.exports = function (api) {
  const web = api.caller((caller) => caller?.platform === "web");
  // The preset adds the worklets plugin without options; on web a worklet runs as plain JS, so its native-only data (the code string) is dead weight in the first load.
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true, ...(web && { worklets: false }) }]],
    plugins: web ? [["react-native-worklets/plugin", { omitNativeOnlyData: true }]] : [],
  };
};
