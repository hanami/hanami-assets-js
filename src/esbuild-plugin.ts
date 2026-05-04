import { BuildResult, Plugin, PluginBuild } from "esbuild";
import fs from "fs-extra";
import path from "path";
import crypto from "node:crypto";
import { globSync } from "glob";
import chokidar, { FSWatcher } from "chokidar";

const URL_SEPARATOR = "/";

export interface PluginOptions {
  root: string;
  sourceDir: string;
  destDir: string;
  sriAlgorithms: Array<string>;
  hash: boolean;
  watch: boolean;
}

interface Asset {
  url: string;
  sri?: Array<string>;
}

interface CopiedAsset {
  sourcePath: string;
  destPath: string;
}

const assetsDirName = "assets";
const fileHashRegexp = /(-[A-Z0-9]{8})(\.\S+)$/;

// ManifestManager serializes manifest reads and writes through a promise queue and writes
// atomically (tmp file + rename), so the esbuild onEnd writer and the chokidar handlers can't race
// on assets.json.
class ManifestManager {
  private manifestPath: string;
  private queue: Promise<any> = Promise.resolve();

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath;
  }

  // Execute an operation with exclusive access to the manifest.
  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const currentQueue = this.queue;
    let resolver: (value: T) => void;
    let rejecter: (error: any) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
    });

    this.queue = currentQueue.then(
      async () => {
        try {
          const result = await operation();
          resolver(result);
          return result;
        } catch (err) {
          rejecter(err);
          throw err;
        }
      },
      async (err) => {
        rejecter(err);
        throw err;
      },
    );

    return promise;
  }

  async read(): Promise<Record<string, Asset>> {
    return this.enqueue(async () => {
      try {
        return await fs.readJSON(this.manifestPath);
      } catch (err) {
        return {};
      }
    });
  }

  async write(manifest: Record<string, Asset>): Promise<void> {
    return this.enqueue(async () => {
      const tempPath = `${this.manifestPath}.tmp`;
      await fs.writeJSON(tempPath, manifest, { spaces: 2 });
      await fs.rename(tempPath, this.manifestPath);
    });
  }

  async updateEntry(key: string, value: Asset): Promise<void> {
    return this.enqueue(async () => {
      const manifest = await this.readUnsafe();
      manifest[key] = value;
      await this.writeUnsafe(manifest);
    });
  }

  async removeEntry(key: string): Promise<void> {
    return this.enqueue(async () => {
      const manifest = await this.readUnsafe();
      if (manifest[key]) {
        delete manifest[key];
        await this.writeUnsafe(manifest);
      }
    });
  }

  // readUnsafe and writeUnsafe skip the queue; only call from inside an enqueue() block that
  // already holds exclusive access.
  private async readUnsafe(): Promise<Record<string, Asset>> {
    try {
      return await fs.readJSON(this.manifestPath);
    } catch (err) {
      return {};
    }
  }

  private async writeUnsafe(manifest: Record<string, Asset>): Promise<void> {
    const tempPath = `${this.manifestPath}.tmp`;
    await fs.writeJSON(tempPath, manifest, { spaces: 2 });
    await fs.rename(tempPath, this.manifestPath);
  }
}

const hanamiEsbuild = (options: PluginOptions): Plugin => {
  let watcher: FSWatcher | null = null;
  let isFirstBuild = true;
  let manifestManager: ManifestManager;

  return {
    name: "hanami-esbuild",

    setup(build: PluginBuild) {
      build.initialOptions.metafile = true;

      const manifestPath = path.join(options.root, options.destDir, "assets.json");
      const assetsSourceDir = path.join(options.sourceDir, assetsDirName);
      const assetsSourcePath = path.join(options.root, assetsSourceDir);

      manifestManager = new ManifestManager(manifestPath);

      // Track files loaded by esbuild so we don't double-process them.
      const loadedFiles = new Set<string>();
      build.onLoad({ filter: /.*/ }, (args) => {
        loadedFiles.add(args.path);
        return null;
      });

      // After build, copy over any non-referenced asset files, and create a manifest.
      build.onEnd(async (result: BuildResult) => {
        const outputs = result.metafile?.outputs;

        if (typeof outputs === "undefined") {
          return;
        }

        // In watch mode after first build, preserve existing static asset entries.
        let manifest: Record<string, Asset> = {};
        if (options.watch && !isFirstBuild) {
          manifest = await manifestManager.read();
        }

        // Copy extra asset files (in dirs besides js/ and css/) into the destination directory.
        //
        // In watch mode, only process all static assets on the first build. Subsequent changes are
        // handled by the chokidar watcher below.
        const copiedAssets: CopiedAsset[] = [];
        if (!options.watch || isFirstBuild) {
          assetDirectories().forEach((dir) => {
            copiedAssets.push(...processAssetDirectory(dir));
          });
        }

        // Add copied assets into the manifest
        for (const copiedAsset of copiedAssets) {
          if (copiedAsset.sourcePath.endsWith(".map")) {
            continue;
          }

          // Take the full path of the copied asset and remove everything up to (and including) the "assets/" dir
          var sourceUrl = copiedAsset.sourcePath.replace(assetsSourcePath + path.sep, "");
          // Then remove the first subdir (e.g. "images/"), since we do not include those in the asset paths
          sourceUrl = sourceUrl.substring(sourceUrl.indexOf("/") + 1);

          manifest[sourceUrl] = prepareAsset(copiedAsset.destPath);
        }

        // Add files already bundled by esbuild into the manifest
        for (const outputFile in outputs) {
          if (outputFile.endsWith(".map")) {
            continue;
          }

          const outputAttrs = outputs[outputFile];
          const inputFiles = Object.keys(outputAttrs.inputs);

          // Determine the manifest key for the esbuild output file
          let manifestKey: string;
          if (
            !(outputFile.endsWith(".js") || outputFile.endsWith(".css")) &&
            inputFiles.length == 1 &&
            inputFiles[0].startsWith(assetsSourceDir + path.sep)
          ) {
            // A non-JS/CSS output with a single input will be an asset file that has been been
            // referenced from JS/CSS.
            //
            // In this case, preserve the original input file's path in the manifest key, so it
            // matches any other files copied over from that path via processAssetDirectory.
            //
            // For example, given the input file "app/assets/images/icons/some-icon.png", return a
            // manifest key of "icons/some-icon.png".
            manifestKey = inputFiles[0]
              .substring(assetsSourceDir.length + 1) // + 1 to account for the sep
              .split(path.sep)
              .slice(1)
              .join(path.sep);
          } else {
            // For all other outputs, determine the manifest key based on the output file name,
            // stripping away the hash suffix added by esbuild.
            //
            // For example, given the output "public/assets/app-2TLUHCQ6.js", return an manifest
            // key of "app.js".
            manifestKey = outputFile
              .replace(options.destDir + path.sep, "")
              .replace(fileHashRegexp, "$2");
          }

          manifest[manifestKey] = prepareAsset(outputFile);
        }

        // Write assets manifest to the destination directory
        await manifestManager.write(manifest);

        //
        // Helper functions
        //

        function assetDirectories(): string[] {
          const excludeDirs = ["js", "css"];

          try {
            const dirs = globSync([path.join(assetsSourcePath, "*")], { nodir: false });
            const filteredDirs = dirs.filter((dir) => {
              const dirName = dir.split(path.sep).pop();
              return !excludeDirs.includes(dirName!);
            });

            return filteredDirs;
          } catch (err) {
            console.error("Error listing external directories:", err);
            return [];
          }
        }

        function processAssetDirectory(assetDir: string): CopiedAsset[] {
          const files = fs.readdirSync(assetDir, { recursive: true });
          const assets: CopiedAsset[] = [];

          files.forEach((file) => {
            const sourcePath = path.join(assetDir, file.toString());

            // Skip files loaded by esbuild; those are added to the manifest separately
            if (loadedFiles.has(sourcePath)) {
              return;
            }

            // Skip directories and any other non-files
            if (!fs.statSync(sourcePath).isFile()) {
              return;
            }

            const fileHash = calculateHash(fs.readFileSync(sourcePath), options.hash);
            const fileExtension = path.extname(sourcePath);
            const baseName = path.basename(sourcePath, fileExtension);
            const destFileName =
              [baseName, fileHash].filter((item) => item !== null).join("-") + fileExtension;
            const destPath = path.join(
              options.destDir,
              path
                .relative(assetDir, sourcePath)
                .replace(path.basename(file.toString()), destFileName),
            );

            if (fs.lstatSync(sourcePath).isDirectory()) {
              assets.push(...processAssetDirectory(destPath));
            } else {
              copyAsset(sourcePath, destPath);
              assets.push({ sourcePath: sourcePath, destPath: destPath });
            }
          });

          return assets;
        }

        // TODO: profile the current implementation vs blindly copying the asset
        function copyAsset(srcPath: string, destPath: string): void {
          if (fs.existsSync(destPath)) {
            const srcStat = fs.statSync(srcPath);
            const destStat = fs.statSync(destPath);

            // File already exists and is up-to-date, skip copying
            if (srcStat.mtimeMs <= destStat.mtimeMs) {
              return;
            }
          }

          if (!fs.existsSync(path.dirname(destPath))) {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
          }

          fs.copyFileSync(srcPath, destPath);

          return;
        }

        function prepareAsset(assetPath: string): Asset {
          var asset: Asset = { url: calculateDestinationUrl(assetPath) };

          if (options.sriAlgorithms.length > 0) {
            asset.sri = [];

            for (const algorithm of options.sriAlgorithms) {
              const subresourceIntegrity = calculateSubresourceIntegrity(
                algorithm,
                path.join(options.root, assetPath),
              );
              asset.sri.push(subresourceIntegrity);
            }
          }

          return asset;
        }

        function calculateDestinationUrl(str: string): string {
          const normalizedUrl = str.replace(/[\\]+/, URL_SEPARATOR);
          return normalizedUrl.replace(/public/, "");
        }

        function calculateSubresourceIntegrity(algorithm: string, path: string): string {
          const content = fs.readFileSync(path, "utf8");
          const hash = crypto.createHash(algorithm).update(content).digest("base64");

          return `${algorithm}-${hash}`;
        }

        // Inspired by https://github.com/evanw/esbuild/blob/2f2b90a99d626921d25fe6d7d0ca50bd48caa427/internal/bundler/bundler.go#L1057
        function calculateHash(hashBytes: Uint8Array, hash: boolean): string | null {
          if (!hash) {
            return null;
          }

          const result = crypto.createHash("sha256").update(hashBytes).digest("hex");

          return result.slice(0, 8).toUpperCase();
        }

        // Set up file watcher for static assets in watch mode.
        if (options.watch && !watcher) {
          const assetDirs = assetDirectories();

          if (assetDirs.length > 0) {
            watcher = chokidar.watch(assetDirs, {
              cwd: options.root,
              ignoreInitial: true,
              persistent: true,
            });

            watcher.on("add", (filePath: string) => {
              const fullPath = path.join(options.root, filePath);
              processWatchedFile(fullPath);
            });

            watcher.on("change", (filePath: string) => {
              const fullPath = path.join(options.root, filePath);
              processWatchedFile(fullPath);
            });

            watcher.on("unlink", (filePath: string) => {
              const fullPath = path.join(options.root, filePath);
              removeWatchedFile(fullPath);
            });

            console.log("[hanami-esbuild] Watching for static asset changes...");
          }

          isFirstBuild = false;
        }

        // Copy a static asset that was added or changed during watch into the destination directory
        // and refresh its entry in the manifest.
        async function processWatchedFile(filePath: string): Promise<void> {
          const assetDirs = assetDirectories();
          const matchedDir = assetDirs.find((dir) => filePath.startsWith(dir));

          if (!matchedDir || loadedFiles.has(filePath)) {
            return;
          }

          if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return;
          }

          // Assumes options.hash is false. If we later want watch mode to support hashed filenames,
          // this needs to mirror processAssetDirectory's hash-and-rename logic.
          const destPath = path.join(options.destDir, path.relative(matchedDir, filePath));
          copyAsset(filePath, destPath);

          try {
            let sourceUrl = filePath.replace(assetsSourcePath + path.sep, "");
            sourceUrl = sourceUrl.substring(sourceUrl.indexOf("/") + 1);
            const asset = prepareAsset(destPath);
            await manifestManager.updateEntry(sourceUrl, asset);
            console.log(`[hanami-esbuild] Updated asset: ${sourceUrl}`);
          } catch (err) {
            console.error(`[hanami-esbuild] Error updating manifest:`, err);
          }
        }

        // Remove a static asset's destination file and manifest entry after it was deleted from the
        // source directory during watch.
        async function removeWatchedFile(filePath: string): Promise<void> {
          const assetDirs = assetDirectories();
          const matchedDir = assetDirs.find((dir) => filePath.startsWith(dir));

          if (!matchedDir || loadedFiles.has(filePath)) {
            return;
          }

          try {
            let sourceUrl = filePath.replace(assetsSourcePath + path.sep, "");
            sourceUrl = sourceUrl.substring(sourceUrl.indexOf("/") + 1);

            const manifest = await manifestManager.read();
            if (manifest[sourceUrl]) {
              const destPath = path.join(
                options.root,
                options.destDir,
                path.relative(matchedDir, filePath),
              );
              if (fs.existsSync(destPath)) {
                fs.removeSync(destPath);
              }

              await manifestManager.removeEntry(sourceUrl);
              console.log(`[hanami-esbuild] Removed asset: ${sourceUrl}`);
            }
          } catch (err) {
            console.error(`[hanami-esbuild] Error removing asset:`, err);
          }
        }
      });

      build.onDispose(() => {
        if (watcher) {
          watcher.close().catch((err) => {
            console.error("[hanami-esbuild] Error closing watcher:", err);
          });
          watcher = null;
        }
      });
    },
  };
};

export default hanamiEsbuild;
