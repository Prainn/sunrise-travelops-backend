'use strict';

const path = require('node:path');
const webpack = require('webpack');

// The release runner executes the bundle on the host, where the ECS role is available.
webpack({
  mode: 'none',
  target: 'node24',
  entry: './ops/whatsapp-backfill/main.cjs',
  externals: { 'pg-native': 'commonjs pg-native' },
  output: { path: path.resolve('dist'), filename: 'whatsapp-backfill.cjs' },
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
  }
});
