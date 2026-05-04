import fs from "fs-extra";
import path from "path";
import esbuild, { BuildContext } from "esbuild";
import chokidar from "chokidar";
import { Args, parseArgs } from "./args.js";
import {
  EsbuildOptions,
  buildOptions,
  watchOptions,
  entryPointsDir,
  findEntryPoints,
} from "./esbuild.js";

interface RunOptions {
  root?: string;
  argv?: string[];
  esbuildOptionsFn?: EsbuildOptionsFn;
}

type EsbuildOptionsFn = (args: Args, esbuildOptions: EsbuildOptions) => EsbuildOptions;

export const run = async function (options?: RunOptions): Promise<BuildContext | void> {
  // TODO: Allow root to be provided (optionally) as a --root arg
  const { root = process.cwd(), argv = process.argv, esbuildOptionsFn = null } = options || {};

  const args = parseArgs(argv);

  const buildEsbuildOptions = (): EsbuildOptions => {
    let esbuildOptions = args.watch ? watchOptions(root, args) : buildOptions(root, args);
    if (esbuildOptionsFn) {
      esbuildOptions = esbuildOptionsFn(args, esbuildOptions);
    }
    return esbuildOptions;
  };

  const errorHandler = (err: any): void => {
    console.log(err);
    process.exit(1);
  };

  if (args.watch) {
    touchManifest(root);

    let ctx = await esbuild.context(buildEsbuildOptions());
    await ctx.watch().catch(errorHandler);

    const sliceRoot = path.join(root, args.path);
    let entryPointsKey = stringifyEntryPoints(findEntryPoints(sliceRoot));

    // Watch the JS source dir so we can detect entry points added or removed after startup.
    // esbuild's BuildContext is otherwise initialized with a fixed set of entry points and won't
    // notice changes to it on its own.
    const entryPointWatcher = chokidar.watch(entryPointsDir(sliceRoot), {
      ignoreInitial: true,
      persistent: true,
    });

    let restartQueue: Promise<void> = Promise.resolve();

    // Replace the running esbuild context if the set of entry points has changed since last check.
    // Serialize restarts through restartQueue so concurrent fs events can't race on
    // dispose/recreate.
    const handleEntryPointFsChange = (): void => {
      restartQueue = restartQueue
        .then(async () => {
          const next = stringifyEntryPoints(findEntryPoints(sliceRoot));
          if (next === entryPointsKey) return;

          console.log("[hanami-esbuild] Entry points changed; restarting build...");
          await ctx.dispose();
          ctx = await esbuild.context(buildEsbuildOptions());
          await ctx.watch();

          // Only commit the new key once the restart fully succeeds; otherwise a transient failure
          // would mask the change and prevent later events from retrying.
          entryPointsKey = next;
        })
        .catch((err) => {
          console.error("[hanami-esbuild] Error restarting build:", err);
        });
    };

    entryPointWatcher.on("add", handleEntryPointFsChange);
    entryPointWatcher.on("unlink", handleEntryPointFsChange);

    // Returned context proxies through to the live esbuild context, but `dispose()` also tears
    // down our entry-point watcher and waits for any in-flight restart to settle before disposing
    // the (then current) context.
    return new Proxy({} as BuildContext, {
      get(_target, prop) {
        if (prop === "dispose") {
          return async (): Promise<void> => {
            await entryPointWatcher.close();
            await restartQueue;
            await ctx.dispose();
          };
        }
        const value = (ctx as any)[prop];
        return typeof value === "function" ? value.bind(ctx) : value;
      },
    });
  } else {
    await esbuild.build(buildEsbuildOptions()).catch(errorHandler);
  }
};

const stringifyEntryPoints = (entries: Record<string, string>): string => {
  return Object.keys(entries)
    .sort()
    .map((key) => `${key}\0${entries[key]}`)
    .join("\n");
};

const touchManifest = (root: string): void => {
  const manifestPath = path.join(root, "public", "assets.json");
  const manifestDir = path.dirname(manifestPath);

  fs.ensureDirSync(manifestDir);

  fs.writeFileSync(manifestPath, JSON.stringify({}, null, 2));
};
