// ====================================================================
// VIEW STRATEGY — LIGHTS (reactive group cards)
// ====================================================================

import type { LovelaceViewConfig } from '../types/lovelace';

export class LightsViewStrategy extends HTMLElement {
  static async generate(config: any, _hass: any): Promise<LovelaceViewConfig> {
    const dashboardConfig = config.dashboardConfig || config.config || {};
    const groupByFloors = dashboardConfig.group_lights_by_floors === true;
    const groupByRooms = dashboardConfig.group_lights_by_rooms === true;
    const nestedGroups = dashboardConfig.nested_light_groups === true;

    return {
      type: 'sections',
      sections: [
        {
          type: 'grid',
          cards: [
            {
              type: 'custom:requinard-lights-group-card',
              entities: config.entities,
              config: config.config,
              group_type: 'on',
              group_by_floors: groupByFloors,
              group_by_rooms: groupByRooms,
              nested_groups: nestedGroups,
            },
            {
              type: 'custom:requinard-lights-group-card',
              entities: config.entities,
              config: config.config,
              group_type: 'off',
              group_by_floors: groupByFloors,
              group_by_rooms: groupByRooms,
              nested_groups: nestedGroups,
            },
          ],
        },
      ],
    };
  }
}

customElements.define('ll-strategy-requinard-view-lights', LightsViewStrategy);
