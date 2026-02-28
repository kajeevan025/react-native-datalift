/**
 * React Native autolinking configuration
 * Ensures proper module discovery for iOS and Android
 * Compatible with React Native 0.70+
 */
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: './android',
      },
    },
  },
};
