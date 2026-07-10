// Copyright (C) 2017-2023 Smart code 203358507

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const webpack = require('webpack');
const threadLoader = require('thread-loader');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const WorkboxPlugin = require('workbox-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const packageJson = require('./package.json');

const COMMIT_HASH = execSync('git rev-parse HEAD').toString().trim();

// Wrap ONLY App/styles.less's output in `@layer legacy` so Tailwind v4 utilities
// (in @layer utilities) win over its universal `* { }` reset. Component-level Less
// stays unlayered/untouched — it only ever targets its own legacy elements, never
// the new Tailwind components, so there is nothing for utilities to lose to there.
const wrapLegacyLayer = () => ({
    postcssPlugin: 'wrap-legacy-layer',
    Once(root, { postcss }) {
        const file = (root.source && root.source.input && root.source.input.file) || '';
        if (!/[\\/]App[\\/]styles\.less$/.test(file)) return;
        const nodes = root.nodes.slice();
        if (!nodes.length) return;
        const layer = postcss.atRule({ name: 'layer', params: 'legacy' });
        root.removeAll();
        nodes.forEach((n) => layer.append(n));
        root.append(layer);
    },
});
wrapLegacyLayer.postcss = true;

// Only ever run our own sources through the loaders.
//
// Upstream expressed this as `exclude: /node_modules/`, which worked because
// every dependency was a real directory under node_modules. In this monorepo
// @rillio/core-web and @rillio/video are workspace:* symlinks
// into crates/ and packages/, so webpack resolves them to real paths that no
// longer match that pattern -- babel/ts-loader would start reprocessing
// already-built package output. An explicit `include` says what we mean.
const SRC = path.resolve(__dirname, 'src');
// Fonts and images are referenced from src/**/*.less and src/**/*.tsx but live
// in a sibling directory, so asset rules must cover both.
const ASSETS = path.resolve(__dirname, 'assets');

const THREAD_LOADER = {
    loader: 'thread-loader',
    options: {
        name: 'shared-pool',
        workers: os.cpus().length,
    },
};

threadLoader.warmup(
    THREAD_LOADER.options,
    [
        'babel-loader',
        'ts-loader',
        'css-loader',
        'postcss-loader',
        'less-loader',
    ],
);

module.exports = (env, argv) => ({
    mode: argv.mode,
    devtool: argv.mode === 'production' ? 'source-map' : 'eval-source-map',
    entry: {
        main: './src/index.js',
        worker: './node_modules/@rillio/core-web/worker.js'
    },
    output: {
        path: path.join(__dirname, 'build'),
        filename: `${COMMIT_HASH}/scripts/[name].js`,
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                include: SRC,
                use: [
                    THREAD_LOADER,
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                '@babel/preset-env',
                                '@babel/preset-react'
                            ],
                        }
                    }
                ]
            },
            {
                test: /\.(ts|tsx)$/,
                include: SRC,
                use: [
                    THREAD_LOADER,
                    {
                        loader: 'ts-loader',
                        options: {
                            happyPackMode: true,
                        }
                    }
                ]
            },
            {
                test: /\.less$/,
                include: SRC,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false
                        }
                    },
                    THREAD_LOADER,
                    {
                        loader: 'css-loader',
                        options: {
                            esModule: false,
                            importLoaders: 2,
                            modules: {
                                namedExport: false,
                                localIdentName: '[local]-[hash:base64:5]'
                            }
                        }
                    },
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [
                                    require('cssnano')({
                                        preset: [
                                            'advanced',
                                            {
                                                autoprefixer: {
                                                    add: true,
                                                    remove: true,
                                                    flexbox: false,
                                                    grid: false
                                                },
                                                cssDeclarationSorter: true,
                                                calc: false,
                                                colormin: false,
                                                convertValues: false,
                                                discardComments: {
                                                    removeAll: true,
                                                },
                                                discardOverridden: false,
                                                discardUnused: false,
                                                mergeIdents: false,
                                                normalizeDisplayValues: false,
                                                normalizePositions: false,
                                                normalizeRepeatStyle: false,
                                                normalizeUnicode: false,
                                                normalizeUrl: false,
                                                reduceIdents: false,
                                                reduceInitial: false,
                                                zindex: false
                                            }
                                        ]
                                    }),
                                    wrapLegacyLayer()
                                ]
                            }
                        }
                    },
                    {
                        loader: 'less-loader',
                        options: {
                            lessOptions: {
                                strictMath: true,
                                ieCompat: false
                            }
                        }
                    }
                ]
            },
            {
                test: /\.css$/,
                include: SRC,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false
                        }
                    },
                    {
                        loader: 'css-loader',
                        options: {
                            esModule: false,
                            importLoaders: 1,
                            modules: false
                        }
                    },
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [
                                    require('@tailwindcss/postcss')
                                ]
                            }
                        }
                    }
                ]
            },
            {
                test: /\.(ttf|woff2)$/,
                include: [SRC, ASSETS],
                type: 'asset/resource',
                generator: {
                    filename: 'fonts/[name][ext][query]'
                }
            },
            {
                test: /\.(png|jpe?g|svg)$/,
                include: [SRC, ASSETS],
                type: 'asset/resource',
                generator: {
                    filename: 'images/[name][ext][query]'
                }
            },
            {
                test: /\.wasm$/,
                type: 'asset/resource',
                generator: {
                    filename: `${COMMIT_HASH}/binaries/[name][ext][query]`
                }
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.json', '.less', '.wasm'],
        // NOTE: `symlinks` must stay at its default (true). pnpm stores each
        // package's own dependencies under .pnpm/<pkg>@<ver>/node_modules, and
        // they are only reachable by resolving the package through its symlink
        // to that real path. Setting symlinks:false strands every transitive
        // dependency (qs, html-parse-stringify, ...).
        alias: {
            'rillio': path.resolve(__dirname, 'src'),
            'rillio-router': path.resolve(__dirname, 'src', 'router')
        }
    },
    devServer: {
        host: '0.0.0.0',
        static: false,
        hot: false,
        // https by default. `--env serverType=http` drops to plain http, which is
        // needed by headless browsers that refuse the self-signed dev cert.
        // Note this is only safe for local verification: the streaming server at
        // http://127.0.0.1:11470 is a potentially-trustworthy origin either way,
        // so serving over http does not change how the app reaches it.
        server: env.serverType === 'http' ? 'http' : 'https',
        liveReload: false
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                test: /\.js$/,
                extractComments: false,
                terserOptions: {
                    ecma: 5,
                    mangle: true,
                    warnings: false,
                    output: {
                        comments: false,
                        beautify: false,
                        wrap_iife: true
                    }
                }
            })
        ]
    },
    plugins: [
        new webpack.ProgressPlugin(),
        new webpack.EnvironmentPlugin({
            SENTRY_DSN: null,
            ...env,
            SERVICE_WORKER_DISABLED: false,
            DEBUG: argv.mode !== 'production',
            VERSION: packageJson.version,
            COMMIT_HASH
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer']
        }),
        argv.mode === 'production' &&
            new WorkboxPlugin.GenerateSW({
                maximumFileSizeToCacheInBytes: 20000000,
                clientsClaim: true,
                skipWaiting: true
            }),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'assets/fonts', to: 'assets/fonts' },
                { from: 'assets/favicons', to: 'favicons' },
                { from: 'assets/images', to: 'images' },
                { from: '.well-known', to: '.well-known' },
                { from: 'manifest.json', to: 'manifest.json' },
            ]
        }),
        new MiniCssExtractPlugin({
            filename: `${COMMIT_HASH}/styles/[name].css`
        }),
        new HtmlWebPackPlugin({
            template: './src/index.html',
            inject: false,
            scriptLoading: 'blocking',
            faviconsPath: 'favicons',
            imagesPath: 'images',
        }),
    ].filter(Boolean)
});
