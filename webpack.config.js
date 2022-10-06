const path = require('path')

const { LicenseWebpackPlugin } = require('license-webpack-plugin')
const webpack = require('webpack')

module.exports = {
  entry: './src/schema.js',
  output: {
    filename: 'schema.cjs',
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'commonjs2'
  },
  mode: 'production',
  target: 'node',
  devtool: 'eval-source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            plugins: [
              '@babel/plugin-proposal-class-properties'
            ]
          }
        }
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('webpack')
      }
    }),
    new LicenseWebpackPlugin({
      outputFilename: 'schema-licenses.txt',
      unacceptableLicenseTest: (licenseType) => (licenseType === 'GPL')
    })
  ]
}
