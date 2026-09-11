# Server Controls

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/v/release/MKANET/ha-server-controls)](https://github.com/MKANET/ha-server-controls/releases)
[![License](https://img.shields.io/github/license/MKANET/ha-server-controls)](LICENSE)

Brings back the **Server Controls** page that was removed from Home Assistant in 2026.5.

![Server Controls page](images/screenshot.png)

## What it does

Adds a **Server Controls** item to the sidebar for admin users. The page is a port of the last upstream version of `/hassio/system` and talks to the same Supervisor API, so it works the way the original did:

- **Core** - version, CPU / RAM usage, Restart, hostname change
- **Supervisor** - version, CPU / RAM usage, Reload, beta channel toggle
- **Host** - OS version, IP, disk usage, Reboot, Shutdown, Hardware list, Import from USB, Move data disk
- **Log viewer** - color log output with provider selection (Advanced mode)

## Requirements

- Home Assistant OS or Supervised (needs the Supervisor)
- Home Assistant 2026.5 or newer

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=MKANET&repository=ha-server-controls&category=integration)

1. Open HACS and go to **Integrations**.
2. Open the menu in the top right and select **Custom repositories**.
3. Add `https://github.com/MKANET/ha-server-controls` with category **Integration**.
4. Search for **Server Controls** and download it.
5. Restart Home Assistant.

### Manual

1. Copy `custom_components/server_controls` into your `config/custom_components` directory.
2. Restart Home Assistant.

## Setup

[![Open your Home Assistant instance and start setting up a new integration.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=server_controls)

Go to **Settings > Devices & services > Add integration**, search for **Server Controls** and add it. There is nothing to configure. The sidebar entry appears right away and is removed when you delete the integration.

No `configuration.yaml` changes are needed.

## Notes

- The page is only visible to admin users, as before.
- The log provider dropdown is shown when **Advanced mode** is enabled in your user profile.
- Network configuration is not part of the page. Use `ha network` from the CLI.

## Credits

Adapted from `hassio/src/system` in [home-assistant/frontend](https://github.com/home-assistant/frontend) (release 20251201.0), Apache 2.0. Bundles [Lit](https://lit.dev) (BSD-3-Clause) and `@material/mwc-button` (Apache 2.0).
