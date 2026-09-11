"""Config flow for the Server Controls integration."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.hassio import is_hassio

from .const import DOMAIN, PANEL_TITLE


class ServerControlsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Create the entry. There is nothing to configure."""
        if not is_hassio(self.hass):
            return self.async_abort(reason="not_hassio")

        return self.async_create_entry(title=PANEL_TITLE, data={})
