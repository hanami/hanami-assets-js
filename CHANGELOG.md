# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Break Versioning](https://www.taoensso.com/break-versioning).

## [Unreleased]

### Added

### Changed

- Bump glob dependency to `^13.0.6` to address deprecation warnings for glob v11 and earlier. (@timriley in #42)

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: https://github.com/hanami/assets-js/compare/v2.3.1...main

## [2.3.1] - 2025-11-14

[2.3.1]: https://github.com/hanami/assets-js/compare/v2.3.0...v2.3.1

## [2.3.0] - 2025-11-12

[2.3.0]: https://github.com/hanami/assets-js/compare/v2.3.0.beta2...v2.3.0

## [2.3.0-beta.2] - 2025-10-03

[2.3.0-beta.2]: https://github.com/hanami/assets-js/compare/v2.3.0.beta1...v2.3.0.beta2

## [2.3.0-beta.1] - 2025-10-03

[2.3.0-beta.1]: https://github.com/hanami/assets-js/compare/v2.2.2...v2.3.0.beta1

## [2.2.2] - 2025-03-14

### Changed

- Bump esbuild dependency to `^0.25.1`. This brings in [the security fix in 0.25.0](https://github.com/evanw/esbuild/releases/tag/v0.25.0) and allows Hanami projects to address the related security warnings. (@timriley in #35)

[2.2.2]: https://github.com/hanami/assets-js/compare/v2.2.1...v2.2.2

## 2.2.1 - 2024-11-12

## 2.2.0 - 2024-11-05

## 2.2.0.rc.1 - 2024-10-29

## 2.2.0.beta.2 - 2024-09-25

## 2.2.0.beta.1 - 2024-07-16

### Added

- Support for `.avip` and `.webp` formats. (@svoop in #28)

## 2.1.1 - 2024-04-01

### Fixed

- Support references to assets in other directories from JS and CSS files (in js/ and css/). (@timriley, krzykamil)

## 2.1.0 - 2024-02-27

## 2.1.0-rc.3 - 2024-02-16

### Changed

- Compile a single directory of assets only (specified by arguments), instead of crawling the app structure to detect assets. The `--path` argument specifies the source directory of assets, and `--dest` specifies the directory to output the compiled assets and the manifest file. The `hanami assets` CLI commands will provide these arguments for each slice, so that each slice has its own separate compiled assets directory and manifest file. (@timriley)

### Fixed

- Copy asset files from deeply nested directories. (@parndt)

## 2.1.0-rc.2 - 2023-11-02

### Added

- Official support for Node 20 and 21. (@jodosha)

### Changed

- Drop support for Node 18. (@jodosha)

## 2.1.0-rc.1 - 2023-11-01

### Changed

- Removed `hanami-assets` executable. (@timriley)
- Export `run` function as main entry point for running Hanami assets commands. (@timriley)

## 2.1.0-beta.2 - 2023-10-04

### Added

- Assets watch mode. (@jodosha)
- Handle static files (images, fonts). (@jodosha)
- Subresource Integrity. (@jodosha)
- Assets manifest. (@jodosha)
- Assets compilation. (@jodosha)
