const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Generated output — never hand-written, never worth linting.
    ignores: [
      "dist/**",
      "static-build/**",
      "server_dist/**",
      ".expo/**",
      "node_modules/**",
    ],
  }
]);
