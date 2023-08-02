#!/usr/bin/env node
/* eslint-disable no-undefined */

import asar from "@electron/asar";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import esbuild from "esbuild";
import path from "path";
import updateNotifier from "update-notifier";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { fileURLToPath, pathToFileURL } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const directory = process.cwd();
const manifestPath = pathToFileURL(path.join(directory, "manifest.json"));

const packageJson = JSON.parse(readFileSync(path.resolve(dirname, "../package.json"), "utf-8"));

const updateMessage = `Update available ${chalk.dim("{currentVersion}")}${chalk.reset(
  " → ",
)}${chalk.green("{latestVersion}")} \nRun ${chalk.cyan("pnpm i -D replugged")} to update`;

const notifier = updateNotifier({
  pkg: packageJson,
  shouldNotifyInNpmScript: true,
});

function sendUpdateNotification() {
  notifier.notify({
    message: updateMessage,
  });
}

/**
 * @typedef Args
 * @property {boolean} [watch]
 * @property {boolean} [noInstall]
 * @property {boolean} [production]
 * @property {boolean} [noReload]
 */

/**
 * @param {(args: Args) => Promise<void>} buildFn
 */
async function bundleAddon(buildFn) {
  if (existsSync("dist")) {
    rmSync("dist", { recursive: true });
  }
  await buildFn({ watch: false, noInstall: true, production: true });

  const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf-8"));
  const outputName = `bundle/${manifest.id}`;

  if (!existsSync("bundle")) {
    mkdirSync("bundle");
  }
  asar.createPackage("dist", `${outputName}.asar`);
  copyFileSync("dist/manifest.json", `${outputName}.json`);

  console.log(`Bundled ${manifest.name}`);
}

/**
 * @param {Args} args
 */
async function buildPlugin({ watch, noInstall, production }) {
  // @ts-expect-error
  let manifest = await import(manifestPath.toString(), {
    assert: { type: "json" },
  });
  if ("default" in manifest) manifest = manifest.default;
  const CHROME_VERSION = "91";
  const REPLUGGED_FOLDER_NAME = "replugged";
  const globalModules = {
    name: "globalModules",
    // @ts-expect-error
    setup: (build) => {
      // @ts-expect-error
      build.onResolve({ filter: /^replugged.+$/ }, (args) => {
        if (args.kind !== "import-statement") return undefined;

        return {
          errors: [
            {
              text: `Importing from a path (${args.path}) is not supported. Instead, please import from "replugged" and destructure the required modules.`,
            },
          ],
        };
      });

      // @ts-expect-error
      build.onResolve({ filter: /^replugged$/ }, (args) => {
        if (args.kind !== "import-statement") return undefined;

        return {
          path: args.path,
          namespace: "replugged",
        };
      });

      build.onLoad(
        {
          filter: /.*/,
          namespace: "replugged",
        },
        () => {
          return {
            contents: "module.exports = window.replugged",
          };
        },
      );
    },
  };

  const CONFIG_PATH = (() => {
    switch (process.platform) {
      case "win32":
        return path.join(process.env.APPDATA || "", REPLUGGED_FOLDER_NAME);
      case "darwin":
        return path.join(
          process.env.HOME || "",
          "Library",
          "Application Support",
          REPLUGGED_FOLDER_NAME,
        );
      default:
        if (process.env.XDG_CONFIG_HOME) {
          return path.join(process.env.XDG_CONFIG_HOME, REPLUGGED_FOLDER_NAME);
        }
        return path.join(process.env.HOME || "", ".config", REPLUGGED_FOLDER_NAME);
    }
  })();

  const install = {
    name: "install",
    // @ts-expect-error
    setup: (build) => {
      build.onEnd(() => {
        if (!noInstall) {
          const dest = path.join(CONFIG_PATH, "plugins", manifest.id);
          if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
          cpSync("dist", dest, { recursive: true });
          // console.log("Installed updated version");
        }
      });
    },
  };

  const common = {
    absWorkingDir: directory,
    bundle: true,
    format: "esm",
    logLevel: "info",
    minify: production,
    platform: "browser",
    plugins: [globalModules, install],
    sourcemap: !production,
    target: `chrome${CHROME_VERSION}`,
    watch,
  };

  const targets = [];

  if ("renderer" in manifest) {
    targets.push(
      // @ts-expect-error
      esbuild.build({
        ...common,
        entryPoints: [manifest.renderer],
        outfile: "dist/renderer.js",
      }),
    );

    manifest.renderer = "renderer.js";
  }

  if ("plaintextPatches" in manifest) {
    targets.push(
      // @ts-expect-error
      esbuild.build({
        ...common,
        entryPoints: [manifest.plaintextPatches],
        outfile: "dist/plaintextPatches.js",
      }),
    );

    manifest.plaintextPatches = "plaintextPatches.js";
  }

  readdirSync("src/themes").forEach((theme) => {
    if (theme === "base16") {
      readdirSync("src/themes/base16").forEach((theme) => {
        targets.push(
          esbuild.build({
            ...common,
            entryPoints: [`src/themes/base16/${theme}`],
            outfile: `dist/themes/base16/${theme}`,
            loader: {
              ".png": "dataurl",
              ".jpg": "dataurl",
            }
          })
        )
      });
    } else if (!(theme.endsWith(".png") || theme.endsWith(".jpg"))) {
      targets.push(
        esbuild.build({
          ...common,
          entryPoints: [`src/themes/${theme}`],
          outfile: `dist/themes/${theme}`,
          loader: {
            ".png": "dataurl",
            ".jpg": "dataurl",
          }
        })
      )
    }
  });

  if (!existsSync("dist")) mkdirSync("dist");

  writeFileSync("dist/manifest.json", JSON.stringify(manifest));

  await Promise.all(targets);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { argv } = yargs(hideBin(process.argv))
  .scriptName("replugged")
  .usage("$0 <cmd> [args]")
  .command(
    "build",
    "Build an Addon",
    (yargs) => {
      yargs.option("no-install", {
        type: "boolean",
        describe: "Don't install the built addon",
        default: false,
      });
      yargs.option("watch", {
        type: "boolean",
        describe: "Watch the addon for changes to reload building",
        default: false,
      });
      yargs.option("production", {
        type: "boolean",
        describe: "Don't compile the source maps when building.",
        default: false,
      });
    },
    (argv) => {
      buildPlugin(argv);
      sendUpdateNotification();
    },
  )
  .command(
    "bundle",
    "Bundle any Addon",
    () => {
      bundleAddon(buildPlugin);
      sendUpdateNotification();
    },
  )
  .parserConfiguration({
    "boolean-negation": false,
  })
  .help();
