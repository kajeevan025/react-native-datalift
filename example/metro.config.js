const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration for the DataLift example app.
 * Resolves the parent library so local development works.
 */
const config = {
  projectRoot: __dirname,
  watchFolders: [root],
  
  resolver: {
    // Block parent's React and React Native to avoid duplicates
    blockList: exclusionList([
      new RegExp(`${root}/node_modules/react/.*`),
      new RegExp(`${root}/node_modules/react-native/.*`),
    ]),
    
    // Explicitly specify node_modules order: example first
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
    ],
    
    // Use src files for development
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react-native-datalift') {
        return {
          filePath: path.join(root, 'src', 'index.ts'),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
