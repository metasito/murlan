// Throwaway probe for #1211. Removed before landing.
const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const FILE = "OrientationProbe.m";

module.exports = function withOrientationProbe(config) {
  config = withDangerousMod(config, [
    "ios",
    async (c) => {
      const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
      fs.copyFileSync(path.join(__dirname, FILE), path.join(c.modRequest.platformProjectRoot, name, FILE));
      return c;
    },
  ]);
  return withXcodeProject(config, (c) => {
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${name}/${FILE}`, groupName: name, project: c.modResults });
    return c;
  });
};
