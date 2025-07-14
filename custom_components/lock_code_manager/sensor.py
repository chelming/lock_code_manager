"""Sensor for lock_code_manager."""

from __future__ import annotations

import logging

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import ATTR_CODE, COORDINATORS, DOMAIN
from .coordinator import LockUsercodeUpdateCoordinator
from .entity import BaseLockCodeManagerCodeSlotPerLockEntity
from .providers import BaseLock

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> bool:
    """Set up config entry."""

    @callback
    def add_code_slot_entities(
        lock: BaseLock, slot_num: int, ent_reg: er.EntityRegistry
    ) -> None:
        """Add code slot sensor entities for slot."""
        _LOGGER.debug(
            "%s (%s): Adding code slot sensor entities for lock %s, slot %s",
            config_entry.entry_id,
            config_entry.title,
            lock.lock.entity_id,
            slot_num
        )
        try:
            coordinator: LockUsercodeUpdateCoordinator = hass.data[DOMAIN][
                config_entry.entry_id
            ][COORDINATORS][lock.lock.entity_id]
            _LOGGER.debug(
                "%s (%s): Found coordinator for lock %s in sensor setup, proceeding to create entities",
                config_entry.entry_id,
                config_entry.title,
                lock.lock.entity_id
            )
        except KeyError as err:
            _LOGGER.warning(
                "%s (%s): Can't create code slot sensor entities because coordinator doesn't "
                "exist yet for lock %s: %s",
                config_entry.entry_id,
                config_entry.title,
                lock.lock.entity_id,
                str(err)
            )
            return
            
        entity = LockCodeManagerCodeSlotSensorEntity(
            hass, ent_reg, config_entry, lock, coordinator, slot_num
        )
        _LOGGER.debug(
            "%s (%s): Created code slot sensor entity: %s, unique_id: %s",
            config_entry.entry_id,
            config_entry.title,
            entity.__class__.__name__,
            entity.unique_id
        )
        
        async_add_entities([entity], True)

    config_entry.async_on_unload(
        async_dispatcher_connect(
            hass,
            f"{DOMAIN}_{config_entry.entry_id}_add_lock_slot",
            add_code_slot_entities,
        )
    )
    return True


class LockCodeManagerCodeSlotSensorEntity(
    BaseLockCodeManagerCodeSlotPerLockEntity,
    SensorEntity,
    CoordinatorEntity[LockUsercodeUpdateCoordinator],
):
    """Code slot sensor entity for lock code manager."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        hass: HomeAssistant,
        ent_reg: er.EntityRegistry,
        config_entry: ConfigEntry,
        lock: BaseLock,
        coordinator: LockUsercodeUpdateCoordinator,
        slot_num: int,
    ) -> None:
        """Initialize entity."""
        BaseLockCodeManagerCodeSlotPerLockEntity.__init__(
            self, hass, ent_reg, config_entry, lock, slot_num, ATTR_CODE
        )
        CoordinatorEntity.__init__(self, coordinator)

    @property
    def native_value(self) -> str | None:
        """Return native value."""
        return self.coordinator.data.get(
            self.slot_num, self.coordinator.data.get(int(self.slot_num))
        )

    @property
    def available(self) -> bool:
        """Return whether sensor is available or not."""
        return BaseLockCodeManagerCodeSlotPerLockEntity._is_available(self) and (
            int(self.slot_num) in self.coordinator.data
        )

    async def async_added_to_hass(self) -> None:
        """Handle entity added to hass."""
        await BaseLockCodeManagerCodeSlotPerLockEntity.async_added_to_hass(self)
        await CoordinatorEntity.async_added_to_hass(self)

        if self.native_value is None:
            self.hass.async_create_task(
                self.async_update(), f"Force update {self.entity_id}"
            )
