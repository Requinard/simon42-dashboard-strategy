import path from 'path';
import webpack from 'webpack';

const config: webpack.Configuration = {
  mode: 'development',
  devtool: 'source-map',
  entry: './src/requinard-dashboard-strategy.ts',
  output: {
    clean: true,
    filename: 'requinard-dashboard-strategy.js',
    path: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1,
    }),
  ],
};

export default config;
