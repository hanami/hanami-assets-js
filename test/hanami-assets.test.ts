import fs from "fs-extra";
import path from "path";
import { globSync } from "glob";
import crypto from "node:crypto";
import * as assets from "../src/index";

const originalWorkingDir = process.cwd();
const dest = path.resolve(__dirname, "..", "tmp", crypto.randomUUID());
const watchTimeout = 60000; // ms (60 seconds)

// Helper function to create a test environment
async function createTestEnvironment() {
  // Create temporary directories
  await fs.ensureDir(path.join(dest, "app/assets/css"));
  await fs.ensureDir(path.join(dest, "app/assets/js"));
  await fs.ensureDir(path.join(dest, "app/assets/js/nested"));
  await fs.ensureDir(path.join(dest, "app/assets/images/nested"));
  await fs.ensureDir(path.join(dest, "app/assets/fonts"));
  await fs.ensureDir(path.join(dest, "slices/admin/assets/js"));
  await fs.ensureDir(path.join(dest, "slices/admin/assets/images/nested"));
  await fs.ensureDir(path.join(dest, "slices/admin/assets/fonts"));
  await fs.ensureDir(path.join(dest, "public"));

  process.chdir(dest);
}

// Helper function to clean up the test environment
async function cleanTestEnvironment() {
  process.chdir(originalWorkingDir);
  await fs.remove(dest); // Comment this line to manually inspect precompile results
}

describe("hanami-assets", () => {
  beforeEach(async () => {
    await createTestEnvironment();
  });

  afterEach(async () => {
    await cleanTestEnvironment();
  });

  test("copies assets from the app to public/assets and generates a manifest file", async () => {
    // Prepare both app and assets slices to make it clear the slice assets are _not_ compiled here
    const appEntryPoint = path.join(dest, "app/assets/js/app.js");
    await fs.writeFile(appEntryPoint, "console.log('Hello, World!');");
    const appImage = path.join(dest, "app/assets/images/nested/app-image.jpg");
    await fs.writeFile(appImage, "app-image");
    const appFont = path.join(dest, "app/assets/fonts/app-font.otf");
    await fs.writeFile(appFont, "app-font");

    const sliceEntryPoint = path.join(dest, "slices/admin/assets/js/app.js");
    await fs.writeFile(sliceEntryPoint, "console.log('Hello, Admin!');");
    const sliceImage = path.join(dest, "slices/admin/assets/images/nested/slice-image.jpg");
    await fs.writeFile(sliceImage, "");

    // Compile assets
    await assets.run({ root: dest, argv: ["--path=app", "--dest=public/assets"] });

    // FIXME: this path should take into account the file hashing in the file name
    const appAsset = globSync(path.join("public/assets/app-*.js"))[0];
    const appAssetExists = await fs.pathExists(appAsset);
    expect(appAssetExists).toBe(true);

    const manifestExists = await fs.pathExists(path.join(dest, "public/assets/assets.json"));
    expect(manifestExists).toBe(true);

    // Read and parse the manifest file
    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    // Check if the manifest contains the correct file paths
    expect(manifest).toEqual({
      "app-font.otf": {
        url: "/assets/app-font-E47AB73F.otf",
      },
      "app.js": {
        url: "/assets/app-JLSTK5SN.js",
      },
      "nested/app-image.jpg": {
        url: "/assets/nested/app-image-C6CAD725.jpg",
      },
    });
  });

  test("copies assets from an admin slice to public/assets/admin and generates a manifest file", async () => {
    // Prepate both app and assets slices to make it clear the app assets are _not_ compiled here
    const appEntryPoint = path.join(dest, "app/assets/js/app.js");
    await fs.writeFile(appEntryPoint, "console.log('Hello, World!');");
    const appImage = path.join(dest, "app/assets/images/nested/app-image.jpg");
    await fs.writeFile(appImage, "");

    const sliceEntryPoint = path.join(dest, "slices/admin/assets/js/app.js");
    await fs.writeFile(sliceEntryPoint, "console.log('Hello, Admin!');");
    const sliceImage = path.join(dest, "slices/admin/assets/images/nested/slice-image.jpg");
    await fs.writeFile(sliceImage, "slice-image");
    const sliceFont = path.join(dest, "slices/admin/assets/fonts/slice-font.otf");
    await fs.writeFile(sliceFont, "slice-font");

    // Compile assets
    await assets.run({ root: dest, argv: ["--path=slices/admin", "--dest=public/assets/admin"] });

    // FIXME: this path should take into account the file hashing in the file name
    const sliceAsset = globSync(path.join("public/assets/admin/app-*.js"))[0];
    const sliceAssetExists = await fs.pathExists(sliceAsset);
    expect(sliceAssetExists).toBe(true);

    const manifestExists = await fs.pathExists(path.join(dest, "public/assets/admin/assets.json"));
    expect(manifestExists).toBe(true);

    // Read and parse the manifest file
    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/admin/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    // Check if the manifest contains the correct file paths
    expect(manifest).toEqual({
      "app.js": {
        url: "/assets/admin/app-ITGLRDE7.js",
      },
      "nested/slice-image.jpg": {
        url: "/assets/admin/nested/slice-image-4951F7C9.jpg",
      },
      "slice-font.otf": {
        url: "/assets/admin/slice-font-826F93B7.otf",
      },
    });
  });

  test("handles references to files outside js/ and css/ directories", async () => {
    const entryPoint = path.join(dest, "app/assets/js/app.js");
    await fs.writeFile(entryPoint, 'import "../css/app.css";');
    const cssFile = path.join(dest, "app/assets/css/app.css");
    await fs.writeFile(
      cssFile,
      `
        @font-face { font-family: "comic-mono-1"; src: url("../fonts/comic-mono-1/comic-mono.ttf"); }
        @font-face { font-family: "comic-mono-2"; src: url("../fonts/comic-mono-2/comic-mono.ttf"); }
      `,
    );

    // Create three same-named font files in distinct directories to ensure we handle name
    // collisions in their manifest keys
    await fs.ensureDir(path.join(dest, "app/assets/fonts/comic-mono-1"));
    const fontFile1 = path.join(dest, "app/assets/fonts/comic-mono-1/comic-mono.ttf");
    await fs.writeFile(fontFile1, "comic-mono-1");
    await fs.ensureDir(path.join(dest, "app/assets/fonts/comic-mono-2"));
    const fontFile2 = path.join(dest, "app/assets/fonts/comic-mono-2/comic-mono.ttf");
    await fs.writeFile(fontFile2, "comic-mono-2");
    await fs.ensureDir(path.join(dest, "app/assets/fonts/comic-mono-3"));
    const fontFile3 = path.join(dest, "app/assets/fonts/comic-mono-3/comic-mono.ttf");
    await fs.writeFile(fontFile3, "comic-mono-3");

    await assets.run({ root: dest, argv: ["--path=app", "--dest=public/assets"] });

    const entryPointExists = await fs.pathExists(path.join("public/assets/app-6PW7FGD5.js"));
    expect(entryPointExists).toBe(true);
    const cssExists = await fs.pathExists(path.join("public/assets/app-MB666W4Y.css"));
    expect(cssExists).toBe(true);
    const font1Exists = await fs.pathExists(path.join("public/assets/comic-mono-IUTNYTIA.ttf")); // comic-mono-1
    expect(font1Exists).toBe(true);
    const font2Exists = await fs.pathExists(path.join("public/assets/comic-mono-BRKWKEKY.ttf")); // comic-mono-2
    expect(font2Exists).toBe(true);
    const font3Exists = await fs.pathExists(
      path.join("public/assets/comic-mono-3/comic-mono-01349269.ttf"),
    ); // comic-mono-3
    expect(font3Exists).toBe(true);

    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    expect(manifest).toEqual({
      "app.js": {
        url: "/assets/app-6PW7FGD5.js",
      },
      "comic-mono-1/comic-mono.ttf": {
        url: "/assets/comic-mono-IUTNYTIA.ttf",
      },
      "comic-mono-2/comic-mono.ttf": {
        url: "/assets/comic-mono-BRKWKEKY.ttf",
      },
      "app.css": {
        url: "/assets/app-MB666W4Y.css",
      },
      "comic-mono-3/comic-mono.ttf": {
        url: "/assets/comic-mono-3/comic-mono-01349269.ttf",
      },
    });
  });

  test("handles files inside js/ directory that was not already processed", async () => {
    const entryPointFile = path.join(dest, "app/assets/js/app.js");
    await fs.writeFile(entryPointFile, "console.log('Hello, World!');");
    const nonEntryPointFile = path.join(dest, "app/assets/js/test.js");
    await fs.writeFile(nonEntryPointFile, "console.log('Hello, Other World!');");

    // Compile assets
    await assets.run({ root: dest, argv: ["--path=app", "--dest=public/assets"] });

    const appAsset = globSync(path.join("public/assets/app-*.js"))[0];
    const appAssetExists = await fs.pathExists(appAsset);
    expect(appAssetExists).toBe(true);

    const otherAsset = globSync(path.join("public/assets/test-*.js"))[0];
    const otherAssetExists = await fs.pathExists(otherAsset);
    expect(otherAssetExists).toBe(true);

    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    expect(manifest).toEqual({
      "app.js": {
        url: "/assets/app-JLSTK5SN.js",
      },
      "test.js": {
        url: "/assets/test-6AF79D7A.js",
      },
    });
  });

  test("generates SRI", async () => {
    const appEntryPoint = path.join(dest, "app/assets/js/app.js");
    await fs.writeFile(appEntryPoint, "console.log('Hello, World!');");

    // Compile assets
    await assets.run({
      root: dest,
      argv: ["--path=app", "--dest=public/assets", "--sri=sha256,sha384,sha512"],
    });

    // Read and parse the manifest file
    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    // Check if the manifest contains the correct file paths
    expect(manifest).toEqual({
      "app.js": {
        url: "/assets/app-JLSTK5SN.js",
        sri: [
          "sha256-p4j9argOiwyiBIBi7v4H0WUnv6z3kmFjqmManMEJXfo=",
          "sha384-gkA54jmSv7TBjiSzGrfO/uCR5CyUrQSUSUYrnM0lICIaP5ppqcN8PLVE3mNj87sN",
          "sha512-ZCJAQgHAxcBP7xEuQ3W/pZqqI611aX9oEk0QvDG4Etq6bkvxQMWHrHk2npCytWchOTN1yKM7TLj9Vsp1Id0j6g==",
        ],
      },
    });
  });

  test("handles CSS", async () => {
    const entryPoint = path.join(dest, "app/assets/js/app.js");
    await fs.writeFile(entryPoint, 'import "../css/app.css";');
    const cssFile = path.join(dest, "app/assets/css/app.css");
    await fs.writeFile(cssFile, ".btn { background: #f00; }");

    await assets.run({ root: dest, argv: ["--path=app", "--dest=public/assets"] });

    const entryPointExists = await fs.pathExists(path.join("public/assets/app-6PW7FGD5.js"));
    expect(entryPointExists).toBe(true);
    const cssExists = await fs.pathExists(path.join("public/assets/app-7O2WUXC5.css"));
    expect(cssExists).toBe(true);

    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    expect(manifest).toEqual({
      "app.css": {
        url: "/assets/app-7O2WUXC5.css",
      },
      "app.js": {
        url: "/assets/app-6PW7FGD5.js",
      },
    });
  });

  test("handles TypeScript", async () => {
    const entryPoint1 = path.join(dest, "app/assets/js/app.ts");
    await fs.writeFile(entryPoint1, "console.log('Hello from TS!');");
    const entryPoint2 = path.join(dest, "app/assets/js/nested/app.tsx");
    await fs.writeFile(entryPoint2, "console.log('Hello from TSX!');");

    // Compile assets
    await assets.run({ root: dest, argv: ["--path=app", "--dest=public/assets"] });

    const asset1Exists = await fs.pathExists(path.join("public/assets/app-2TLUHCQ6.js"));
    expect(asset1Exists).toBe(true);
    const asset2Exists = await fs.pathExists(path.join("public/assets/nested/app-5VHYTKP2.js"));
    expect(asset2Exists).toBe(true);

    const manifestExists = await fs.pathExists(path.join(dest, "public/assets/assets.json"));
    expect(manifestExists).toBe(true);

    // Read and parse the manifest file
    const manifestContent = await fs.readFile(
      path.join(dest, "public/assets/assets.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);

    // Check if the manifest contains the correct file paths
    expect(manifest).toEqual({
      "app.js": {
        url: "/assets/app-2TLUHCQ6.js",
      },
      "nested/app.js": {
        url: "/assets/nested/app-5VHYTKP2.js",
      },
    });
  });

  test(
    "watch",
    async () => {
      const images = path.join(dest, "app", "assets", "images");
      await fs.ensureDir(images);
      fs.copySync(
        path.join(__dirname, "fixtures", "todo", "app", "assets", "images", "background.jpg"),
        path.join(images, "background.jpg"),
      );

      const entryPoint = path.join(dest, "app", "assets", "js", "app.js");
      await fs.writeFile(entryPoint, "console.log('Hello, World!');");

      const appAsset = path.join(dest, "public", "assets", "app.js");
      const imageAsset = path.join(dest, "public", "assets", "background.jpg");

      // Watch for asset changes
      let ctx = await assets.run({
        root: dest,
        argv: ["--path=app", "--dest=public/assets", "--watch"],
      });

      await fs.writeFile(entryPoint, "console.log('Hello, Watch!');");

      const appAssetExists = (timeout = watchTimeout): Promise<boolean> => {
        return new Promise((resolve, reject) => {
          let elapsedTime = 0;
          const intervalTime = 100;

          const interval = setInterval(() => {
            if (fs.existsSync(appAsset)) {
              clearInterval(interval);
              resolve(true);
            }

            elapsedTime += intervalTime;
            if (elapsedTime >= timeout) {
              clearInterval(interval);
              reject(false);
            }
          }, intervalTime);
        });
      };

      const found = await appAssetExists();
      expect(found).toBe(true);

      expect(fs.existsSync(imageAsset)).toBe(true);

      // Read the asset file
      const assetContent = await fs.readFile(appAsset, "utf-8");

      // Check if the asset has the expected contents
      expect(assetContent).toMatch('console.log("Hello, Watch!");');

      const manifestExists = await fs.pathExists(path.join(dest, "public/assets/assets.json"));
      expect(manifestExists).toBe(true);

      // Read and parse the manifest file
      const manifestContent = await fs.readFile(
        path.join(dest, "public/assets/assets.json"),
        "utf-8",
      );
      const manifest = JSON.parse(manifestContent);

      expect(manifest["background.jpg"]).toEqual({
        url: "/assets/background.jpg",
      });

      await ctx!.dispose();
    },
    watchTimeout + 1000,
  );
});
