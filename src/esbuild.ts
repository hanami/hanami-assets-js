import path from "path";
import { globSync } from "glob";
import { BuildOptions, Loader, Plugin } from "esbuild";
import { Args } from "./args.js";
import esbuildPlugin, { PluginOptions } from "./esbuild-plugin.js";

export interface EsbuildOptions extends Partial<BuildOptions> {
  plugins: Plugin[];
}

const loader: { [ext: string]: Loader } = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".js": "js",
  ".jsx": "jsx",
  ".json": "json",
  ".png": "file",
  ".jpg": "file",
  ".jpeg": "file",
  ".gif": "file",
  ".avif": "file",
  ".webp": "file",
  ".svg": "file",
  ".woff": "file",
  ".woff2": "file",
  ".otf": "file",
  ".eot": "file",
  ".ttf": "file",
};

const assetsDirName = "assets";
const entryPointExtensions = "app.{js,ts,mjs,mts,tsx,jsx}";

export const entryPointsDir = (sliceRoot: string): string =>
  path.join(sliceRoot, assetsDirName, "js");

export const findEntryPoints = (sliceRoot: string): Record<string, string> => {
  const result: Record<string, string> = {};

  const entryPoints = globSync([
    path.join(sliceRoot, assetsDirName, "js", "**", entryPointExtensions),
  ]);

  entryPoints.forEach((entryPoint) => {
    let entryPointPath = entryPoint.replace(sliceRoot + "/assets/js/", "");

    const { dir, name } = path.parse(entryPointPath);

    if (dir) {
      entryPointPath = path.join(dir, name);
    } else {
      entryPointPath = name;
    }

    result[entryPointPath] = entryPoint;
  });

  return result;
};

const commonPluginOptions = (root: string, args: Args): PluginOptions => {
  return {
    root: root,
    sourceDir: args.path,
    destDir: args.dest,
    hash: true,
    sriAlgorithms: [],
    watch: false,
  };
};

const commonOptions = (root: string, args: Args, plugin: Plugin): EsbuildOptions => {
  return {
    bundle: true,
    outdir: args.dest,
    absWorkingDir: root,
    loader: loader,
    logLevel: "info",
    entryPoints: findEntryPoints(path.join(root, args.path)),
    plugins: [plugin],
  };
};

export const buildOptions = (root: string, args: Args): EsbuildOptions => {
  const pluginOptions: PluginOptions = {
    ...commonPluginOptions(root, args),
    sriAlgorithms: args.sri || [],
  };
  const plugin = esbuildPlugin(pluginOptions);

  const options = {
    ...commonOptions(root, args, plugin),
    entryNames: "[dir]/[name]-[hash]",
    minify: true,
    sourcemap: true,
  };

  return options;
};

export const watchOptions = (root: string, args: Args): EsbuildOptions => {
  const pluginOptions: PluginOptions = {
    ...commonPluginOptions(root, args),
    hash: false,
    watch: true,
  };
  const plugin = esbuildPlugin(pluginOptions);

  const options = {
    ...commonOptions(root, args, plugin),
    entryNames: "[dir]/[name]",
    minify: false,
    sourcemap: false,
  };

  return options;
};
