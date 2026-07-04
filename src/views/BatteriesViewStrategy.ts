// ====================================================================
// VIEW STRATEGY — BATTERIES (Battery Status Overview)
// ====================================================================

import type { HomeAssistant } from '../types/homeassistant';
import type { LovelaceViewConfig, LovelaceSectionConfig } from '../types/lovelace';
import { Registry } from '../Registry';
import { localize } from '../utils/localize';
import { getBatteryEntities } from '../utils/entity-filter';

function createBatterySection(
  entities: string[],
  status: 'critical' | 'low' | 'good',
  rangeText: string,
): LovelaceSectionConfig | null {
  if (entities.length === 0) return null;

  const emoji = status === 'critical' ? '🔴' : status === 'low' ? '🟡' : '🟢';
  const color = status === 'critical' ? 'red' : status === 'low' ? 'yellow' : 'green';

  return {
    type: 'grid',
    cards: [
      {
        type: 'heading',
        heading: `${emoji} ${localize('batteries.' + status)} (${rangeText}) - ${entities.length} ${
          localize(entities.length === 1 ? 'batteries.battery_one' : 'batteries.battery_many')
        }`,
        heading_style: 'title',
      },
      ...entities.map((e) => ({
        type: 'tile',
        entity: e,
        vertical: false,
        state_content: ['state', 'last_changed'],
        color,
      })),
    ],
  };
}

class RequinardViewBatteriesStrategy extends HTMLElement {
  static async generate(config: any, hass: HomeAssistant): Promise<LovelaceViewConfig> {
    // Ensure Registry is initialized (idempotent — no-op if already done)
    Registry.initialize(hass, config.config || {});

    const batteryEntities = getBatteryEntities(hass, config.config);

    const strategyConfig = config.config || {};
    const dashboardConfig = config.dashboardConfig || config.config || {};
    const criticalThreshold = strategyConfig.battery_critical_threshold ?? 20;
    const lowThreshold = strategyConfig.battery_low_threshold ?? 50;
    const critical: string[] = [];
    const low: string[] = [];
    const good: string[] = [];

    for (const entityId of batteryEntities) {
      const state = hass.states[entityId];
      if (entityId.startsWith('binary_sensor.')) {
        (state.state === 'on' ? critical : good).push(entityId);
        continue;
      }
      const value = parseFloat(state.state);
      const unit = state.attributes?.unit_of_measurement;
      // Only apply percentage thresholds to %-based sensors.
      // Voltage sensors (V, mV) have device-specific ranges and cannot be
      // meaningfully compared against percentage thresholds (e.g. 3V would
      // be "critical" at < 20 which is wrong). Skip them entirely.
      if (unit && unit !== '%') continue;
      if (isNaN(value)) critical.push(entityId);
      else if (value < criticalThreshold) critical.push(entityId);
      else if (value <= lowThreshold) low.push(entityId);
      else good.push(entityId);
    }

    const groupByFloors = dashboardConfig.group_batteries_by_floors === true;
    const groupByRooms = dashboardConfig.group_batteries_by_rooms === true;

    const sections: LovelaceSectionConfig[] = [
      {
        type: 'grid',
        cards: [
          {
            type: 'custom:requinard-batteries-group-card',
            status: 'critical',
            range_text: `< ${criticalThreshold}%`,
            color: 'red',
            config: strategyConfig,
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
          {
            type: 'custom:requinard-batteries-group-card',
            status: 'low',
            range_text: `${criticalThreshold}% - ${lowThreshold}%`,
            color: 'yellow',
            config: strategyConfig,
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
          {
            type: 'custom:requinard-batteries-group-card',
            status: 'good',
            range_text: `> ${lowThreshold}%`,
            color: 'green',
            config: strategyConfig,
            group_by_floors: groupByFloors,
            group_by_rooms: groupByRooms,
          },
        ],
      },
    ];

    return { type: 'sections', sections };
  }
}

customElements.define('ll-strategy-requinard-view-batteries', RequinardViewBatteriesStrategy);
