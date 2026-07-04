// ====================================================================
// VIEW STRATEGY — CLIMATE (Climate/Thermostat Overview)
// ====================================================================

import type { HomeAssistant } from '../types/homeassistant';
import type { LovelaceViewConfig, LovelaceSectionConfig } from '../types/lovelace';
import { Registry } from '../Registry';
import { localize } from '../utils/localize';

class RequinardViewClimateStrategy extends HTMLElement {
  static async generate(config: any, hass: HomeAssistant): Promise<LovelaceViewConfig> {
    // Ensure Registry is initialized (idempotent — no-op if already done)
    Registry.initialize(hass, config.config || {});

    const climateIds = Registry.getVisibleEntityIdsForDomain('climate').filter(
      (id) => hass.states[id] !== undefined
    );

    const dashboardConfig = config.dashboardConfig || config.config || {};
    const groupByFloors = dashboardConfig.group_climate_by_floors === true;
    const groupByRooms = dashboardConfig.group_climate_by_rooms === true;

    const sections: LovelaceSectionConfig[] = [
      {
        type: 'grid',
        cards: [
          {
            type: 'custom:requinard-climate-group-card',
            hvac_status: 'heating',
            heading: localize('climate.heating'),
            icon: 'mdi:fire',
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
          {
            type: 'custom:requinard-climate-group-card',
            hvac_status: 'cooling',
            heading: localize('climate.cooling'),
            icon: 'mdi:snowflake',
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
          {
            type: 'custom:requinard-climate-group-card',
            hvac_status: 'idle',
            heading: localize('climate.idle'),
            icon: 'mdi:thermostat',
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
          {
            type: 'custom:requinard-climate-group-card',
            hvac_status: 'off',
            heading: localize('climate.off'),
            icon: 'mdi:power-off',
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
        ],
      },
    ];

    return { type: 'sections', sections };
  }
}

customElements.define('ll-strategy-requinard-view-climate', RequinardViewClimateStrategy);
