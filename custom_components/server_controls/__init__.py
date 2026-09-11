"""Server Controls integration.

Registers the restored Supervisor system panel and serves its frontend files
from this package, so no configuration.yaml or www/ setup is required.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.hassio import is_hassio
from homeassistant.loader import async_get_integration

from .const import (
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_MODULE,
    PANEL_TITLE,
    PANEL_URL_PATH,
)

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent / "frontend"
DATA_STATIC_URL = f"{DOMAIN}_static_url"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Server Controls from a config entry."""
    if not is_hassio(hass):
        _LOGGER.error("Server Controls requires a Supervisor based installation")
        return False

    # Static paths cannot be unregistered, so register them once per runtime.
    # The version is part of the URL so browsers pick up new files on upgrade.
    if DATA_STATIC_URL not in hass.data:
        integration = await async_get_integration(hass, DOMAIN)
        static_url = f"/{DOMAIN}/{integration.version}"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(static_url, str(FRONTEND_DIR), True)]
        )
        hass.data[DATA_STATIC_URL] = static_url

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{hass.data[DATA_STATIC_URL]}/{PANEL_MODULE}",
        require_admin=True,
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Server Controls."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
