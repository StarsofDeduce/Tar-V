<p align="center">
  <img src="tray.png" width="96" alt="Tar V icon">
</p>

<h1 align="center">Tar V</h1>

<p align="center">
  <strong>A fast, clean, and customizable local launcher for Windows</strong><br>
  <sub>Keep apps, games, files, folders, and shortcuts in one place.</sub>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.1-61269C?style=flat-square" alt="Version 2.0.1">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6?style=flat-square&logo=windows" alt="Windows 10 and 11">
  <img src="https://img.shields.io/badge/framework-Electron-47848F?style=flat-square&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat-square" alt="MIT License">
</p>

## Overview

Tar V is a local quick-launch panel built for Windows. It brings applications, Steam games, files, folders, URLs, and shortcuts into a panel that is always one hotkey away, instead of leaving frequently used items scattered across the desktop, Start menu, and nested folders.

Open Tar V with a global hotkey, browse groups or search, and launch an item directly. The panel supports drag-and-drop, group management, batch editing, elevated launch, automatic hiding, and several keyboard and mouse navigation options. Configuration and icon caches stay on the local computer; no account or cloud service is required.

## What's new in 2.0.1

Version 2.0.1 focuses on reliable imports and launching, correct Windows icons, bounded background refreshes, and clearer context menus and errors.

- Fixed dropped, batch-imported, and manually added entries appearing before persistence succeeded, disappearing after restart, or failing to launch.
- Shortcuts retain their original source and are resolved again before launch. Missing targets can be repaired from a high-confidence candidate only after user confirmation.
- Directories always use the current Windows folder-type icon; names and executables inside a directory no longer change its type.
- Improved `.exe`, `.lnk`, `.url`, resource-index, and Squirrel.Windows icon resolution, including apps that use `Update.exe --processStart`, such as Discord.
- Icon caches use the complete item source so applications, folders, or paths with similar names cannot share an unrelated icon.
- Background migration deduplicates requests and commits icon metadata only, avoiding repeated full-configuration writes and concurrent edit loss.
- Unified item, group, and background context menus with no Emoji, plus keyboard navigation, focus restoration, and distinct destructive actions.
- Launch failures now use structured, readable messages; raw PowerShell and CLIXML error streams are kept out of the interface.
- Settings save as one transaction. A failed hotkey or autostart update restores both the system state and configuration.
- Icon request, cache-record, and data-URL sizes are bounded to reduce memory and disk pressure from abnormal files.

## What's new in 2.0.0

Tar V 2.0.0 is a broad revision of icon compatibility, settings, performance, and security—not just a visual refresh.

### More reliable Windows icons

- Improved icon resolution for `.exe`, `.lnk`, `.url`, folders, and regular files.
- Reads icon files and resource indexes declared by shortcuts instead of relying only on the target executable's default icon.
- Better recognition of protocol-based game shortcuts such as Steam, with stable protocol-specific fallbacks.
- Uses bounded memory and disk caches plus a worker queue so repeated icon extraction does not block the interface.
- Falls back to clear file, folder, or web icons instead of leaving broken images.
- Existing entries can be rescanned from the Maintenance page.

### Redesigned Settings Center

- Compact horizontal navigation removes unnecessary visual layers.
- Supports dark, light, and system themes.
- A new “Settings Center follows interface theme” option automatically applies built-in dark or light palettes. Turn it off to configure the Settings Center background and accent independently.
- Appearance changes preview immediately. Cancel restores the previous appearance; Save writes the new configuration.
- Typography, controls, switches, separators, and action buttons were reorganized for clearer reading and safer interaction at different window sizes.
- The interface uses a consistent solid-color visual system.

### Performance, stability, and security

- Large icon payloads are no longer stored permanently in the primary configuration, reducing file size and duplicate memory use.
- Icon caches are limited by both entry count and total bytes.
- Settings-window references are released on close so repeated open/close cycles do not retain window instances.
- Configuration import, launch arguments, IPC source validation, and file-access boundaries were hardened.
- Electron renderers keep sandboxing and context isolation enabled, with a strict Content Security Policy that blocks remote and inline scripts.
- A release audit checks packaged files for local paths, common credential patterns, and personal-data traces before publication.

## Preview

### Launcher panel

<p align="center">
  <img src="docs/screenshots/panel.png" width="760" alt="Tar V launcher panel">
  <br>
  <sub>Groups, search, native Windows icons, and quick launching</sub>
</p>

### Settings Center

<table>
  <tr>
    <td align="center"><strong>Dark</strong></td>
    <td align="center"><strong>Light</strong></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings.png" alt="Tar V Settings Center in dark mode"></td>
    <td><img src="docs/screenshots/settings-light.png" alt="Tar V Settings Center in light mode"></td>
  </tr>
</table>

> The screenshots use test configuration and built-in Windows entries. They contain no personal files, accounts, or local paths.

## Features

### Quick access and launching

- Show or hide the panel with a customizable global hotkey.
- Choose single-click or double-click launching.
- Launch normally or request elevation for a single launch.
- Hide the panel after launch, when it loses focus, or when `Esc` is pressed.
- Open the panel at the screen center or near the pointer.

### Item and group management

- Supports applications, games, files, folders, URLs, `.lnk`, and `.url` shortcuts.
- Drop files, folders, or shortcuts onto the panel to add them.
- Import multiple items from a folder.
- Create, rename, delete, and drag groups into a new order.
- Reorder items by insertion or position swapping.
- Use the context menu to launch, elevate, reveal, edit, or remove an item.

### Search and batch actions

- Filter names and groups as you type.
- Move several items or update their launch arguments and elevation preference together.
- Sort items by name and remove duplicates.
- Scan for missing local targets and remove invalid entries.
- Remove empty groups.

### Personalization

- Dark, light, and system themes.
- Configurable launcher accent, opacity, and corner radius.
- Independent or synchronized launcher and Settings Center colors.
- Adjustable columns and separate font sizes for tabs, items, and settings.
- Optional icon-only layout with hidden item names.

### Multiple ways to switch groups

- Click a tab.
- Hover over a tab.
- Cycle with the mouse wheel.
- Jump with number keys `1`–`9`.

### Backup and restore

- Export groups, items, and settings to JSON.
- Validate fields, types, lengths, and references before import.
- Review a change summary before applying a backup, with explicit warnings for autostart, global hotkeys, and elevated items.

## Settings Center

| Area | Controls |
| :--- | :--- |
| **General** | Display language, launch at sign-in, search-box visibility |
| **Appearance** | Theme, Settings Center follow mode, colors, opacity, corners, columns, labels, and font sizes |
| **Preferences** | Single/double-click launch, drag behavior, hide after launch, hide when focus is lost |
| **Show and hide** | Global hotkey, `Esc` behavior, window position, and centering |
| **Group switching** | Hover, mouse-wheel, and number-key switching |
| **Common apps** | Shortcuts for built-in Windows tools |
| **Maintenance** | Icon repair, sorting, duplicate cleanup, missing targets, and empty groups |
| **Backup and restore** | Export configuration, review and import backups |

## Install and upgrade

### Install

1. Download `Tar V Setup 2.0.1.exe` from [Releases](../../releases).
2. Run the installer and select an installation directory.
3. Choose whether to create Desktop and Start menu shortcuts.
4. Start Tar V and configure the global hotkey and common entries in Settings.

The NSIS installer supports a custom destination and registers Tar V in Windows Apps & Features.

### Upgrade from 2.0.0 or 1.x

Version 2.0.1 preserves existing groups, items, and settings while removing confirmed obsolete experimental fields. Export a JSON backup from “Backup and restore” before upgrading so you always have a recovery point.

## Icon compatibility

Tar V considers the item target, the shortcut file, and any icon file and resource index declared by that shortcut. When a protocol link has no extractable local icon, Tar V selects a fallback for that protocol.

If an upgraded entry still shows an old icon:

1. Open **Settings Center → Maintenance**.
2. Run icon repair.
3. If needed, add the original `.lnk` or `.url` again instead of adding only its resolved target.

Some game platforms move local icon resources during client or game updates. Run icon repair again when this happens.

## Security design

Tar V launches local programs, resolves shortcuts, and reads icons, so it crosses desktop security boundaries that normal web applications do not have. The project constrains those capabilities as follows:

| Boundary | Control |
| :--- | :--- |
| **Launch arguments** | Parses arguments into an array and creates the process without a shell. Batch files use dedicated escaping and reject `%VAR%` and `!VAR!` expansion payloads. |
| **Elevated launch** | Requests authorization through Windows UAC. Targets and arguments remain separate instead of interpolating user input into a command. |
| **PowerShell** | Uses UTF-16LE `EncodedCommand` and passes paths and arguments as literals. |
| **Renderer isolation** | Enables `sandbox` and `contextIsolation`, disables `nodeIntegration`, and blocks external navigation and pop-ups. |
| **Content Security Policy** | Rejects remote scripts, inline scripts, inline events, and plugin objects; fonts are bundled locally. |
| **Configuration import** | Allows known fields and types only, limits counts and string lengths, rejects missing group references and duplicate IDs, and confirms sensitive changes. |
| **IPC** | Validates the source window, top-level frame, and local page. Launch requests carry an item ID; the main process reloads the actual target from validated configuration. |
| **File access** | Normalizes paths and enforces access boundaries around user-authorized files and directories. |
| **Release audit** | Scans packaged content for local paths, credential patterns, and personal-data traces. |

Do not publish directly exploitable security details in a public issue. Open an issue without technical details first to request a private communication channel with the maintainer.

## Local data and privacy

- Tar V does not require an account.
- Configuration, backups, and icon caches stay on the local computer by default.
- Tar V does not upload the launch list or local paths to a cloud service.
- Before posting screenshots in a public issue, hide usernames, file paths, and private application names.

## Development

### Requirements

- Windows 10 or Windows 11 (x64)
- Node.js 20 or later
- npm

### Get the source

```powershell
git clone https://github.com/StarsOfDeduce/Tar-V.git
cd Tar-V
npm install
npm start
```

### Tests

Run Node.js functional and security tests:

```powershell
npm test
```

The suite covers argument parsing, `cmd` and PowerShell escaping, path boundaries, configuration validation, shortcut resolution, icon caching, launch policy, and command-injection payloads.

Run the Electron renderer regression test:

```powershell
npm run test:renderer
```

This verifies that the launcher and Settings pages load under the sandbox and strict CSP, then checks the preload bridge, theme colors, settings controls, blocked navigation and pop-ups, and console errors.

### Build and release audit

```powershell
npm run dist
npm run audit:release
```

Default outputs:

| File | Purpose |
| :--- | :--- |
| `dist/Tar V Setup 2.0.1.exe` | Windows x64 NSIS installer |
| `dist/win-unpacked/Tar V.exe` | Unpacked build for local verification |

Before a public release, complete the renderer regression, installation test, dependency audit, and packaged-content audit.

## Project structure

```text
Tar-V/
├── main.js                  # Electron main process, windows, tray, and IPC
├── preload.js               # Restricted Renderer API bridge
├── lib/
│   ├── args.js              # Windows argument parsing and escaping
│   ├── config-schema.js     # Configuration import validation
│   ├── icon-cache.js        # Entry- and byte-bounded LRU icon cache
│   ├── icon-service.js      # Icon resolution, extraction, cache, and fallbacks
│   ├── launch-policy.js     # Launch target and permission policy
│   ├── launch.js            # Process launch flow
│   ├── path-guard.js        # File-system access boundaries
│   ├── powershell.js        # Encoded PowerShell invocation and icon extraction
│   ├── security-boundary.js # Window, navigation, and IPC source validation
│   └── shortcut.js          # `.lnk`, `.url`, and protocol resolution
├── renderer/                # Launcher, Settings Center, styles, and local fonts
├── scripts/                 # Release-audit tooling
├── test/                    # Functional, security, icon, and renderer tests
├── docs/screenshots/        # README screenshots
├── tray.png                 # Application and tray icon
├── package.json             # Scripts, dependencies, and build configuration
└── LICENSE                  # MIT License
```

## FAQ

### Why do some games show a generic icon?

A game shortcut may be only a protocol URL such as `steam://`, with no directly readable image. Tar V first tries the local icon declared by the shortcut. If the platform moved or removed that resource, Tar V uses a protocol fallback.

### Why does elevated launch display a UAC prompt?

That prompt is the Windows permission boundary. Tar V does not bypass UAC and requests elevation only when you explicitly choose an elevated launch.

### Can I synchronize multiple computers?

There is no cloud sync in the current release. Export JSON from “Backup and restore,” then import it on another computer. Referenced files and applications must still exist at compatible paths.

### Does Tar V support macOS or Linux?

Not currently. Icon extraction, shortcut parsing, global launching, and installation are designed specifically for Windows.

## License

Tar V is available under the [MIT License](LICENSE).

<p align="center">
  <sub>Made with care by <a href="https://github.com/StarsOfDeduce">StarsOfDeduce</a></sub>
</p>
