const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

class RemoveModuleScriptPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('RemoveModuleScriptPlugin', (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
        'RemoveModuleScriptPlugin',
        (data, cb) => {
          // Remove the original script tag for demo.js
          data.html = data.html.replace(
            /<script type="module" src="demo.js"><\/script>/g,
            ''
          );
          cb(null, data);
        }
      );
    });
  }
}

module.exports = {
  mode: 'production',
  entry: {
    main: ['./demo.js'],
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
    clean: true,
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      inject: 'body',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        useShortDoctype: true
      }
    }),
    new RemoveModuleScriptPlugin(),
    new HtmlInlineScriptPlugin(),
    new MiniCssExtractPlugin({
      filename: '[name].css'
    }),
    new CopyWebpackPlugin({
      patterns: [
        // Copy image files
        {
          from: '*.png',
          to: '[name][ext]'
        },
        // Copy CSS files
        {
          from: 'style.css',
          to: 'style.css',
          noErrorOnMissing: true
        }
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader'
        ]
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif|webp)$/i,
        type: 'asset/resource',
        generator: {
          filename: '[name][ext]'
        }
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.json']
  }
};