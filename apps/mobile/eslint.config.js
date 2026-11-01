// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // ImageBackground is deprecated in RN 0.88 (removal announced) and its
    // LogBox warning is suppressed at the root (transitive NativeWind noise).
    // This rule keeps the suppression honest: the deprecated component can
    // never be (re)introduced where the ignore would hide it.
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'react-native',
          importNames: ['ImageBackground'],
          message: 'ImageBackground is deprecated and will be removed. Use a View with an absolutely positioned Image instead: https://reactnative.dev/docs/imagebackground',
        }],
      }],
    },
  },
]);
