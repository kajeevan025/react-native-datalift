const path = require('path');

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        alias: {
          'react-native-datalift': path.resolve(__dirname, '..', 'src'),
        },
      },
    ],
  ],
};
