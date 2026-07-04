// ====================================================================
// VIEW STRATEGY — SECURITY (Locks, Doors, Garages, Windows, Smoke/Gas)
// ====================================================================

import type { HomeAssistant } from '../types/homeassistant';
import type { LovelaceViewConfig, LovelaceCardConfig, LovelaceSectionConfig } from '../types/lovelace';
import { Registry } from '../Registry';
import { localize } from '../utils/localize';
import { SECURITY_EXCLUDED_PLATFORMS } from '../utils/entity-filter';

class RequinardViewSecurityStrategy extends HTMLElement {
  static async generate(config: any, hass: HomeAssistant): Promise<LovelaceViewConfig> {
    // Ensure Registry is initialized (idempotent — no-op if already done)
    Registry.initialize(hass, config.config || {});

    // Use pre-filtered visible entities from Registry
    // Covers lock, cover, binary_sensor domains across all areas
    const allVisibleByDomain = (domain: string) => Registry.getVisibleEntityIdsForDomain(domain);

    // Categorize entities
    const locks: string[] = [];
    const doors: string[] = [];
    const garages: string[] = [];
    const windows: string[] = [];
    const smokeGas: string[] = [];

    for (const id of [
      ...allVisibleByDomain('lock'),
      ...allVisibleByDomain('cover'),
      ...allVisibleByDomain('binary_sensor'),
    ]) {
      if (!hass.states[id]) continue;

      const state = hass.states[id];
      const deviceClass = state.attributes?.device_class;

      if (id.startsWith('lock.')) {
        locks.push(id);
      } else if (id.startsWith('cover.')) {
        if (deviceClass === 'garage') garages.push(id);
        else if (deviceClass === 'door' || deviceClass === 'gate' || deviceClass === 'window') doors.push(id);
      } else if (id.startsWith('binary_sensor.')) {
        const entry = Registry.getEntity(id);
        if (entry?.platform && SECURITY_EXCLUDED_PLATFORMS.has(entry.platform)) continue;
        if (deviceClass && ['door', 'window', 'garage_door', 'opening'].includes(deviceClass)) windows.push(id);
        else if (deviceClass && ['smoke', 'gas'].includes(deviceClass)) smokeGas.push(id);
      }
    }

    const dashboardConfig = config.dashboardConfig || config.config || {};
    const groupByFloors = dashboardConfig.group_security_by_floors === true;
    const groupByRooms = dashboardConfig.group_security_by_rooms === true;

    const sections: LovelaceSectionConfig[] = [];

    const buildSecuritySection = (entities: string[], headingKey: string, icon: string, features?: any[], batchAction?: any) => {
      if (entities.length === 0) return;

      const unlocked = entities.filter((e) => {
        const s = hass.states[e]?.state;
        return s === 'unlocked' || s === 'open' || s === 'on';
      });
      const locked = entities.filter((e) => {
        const s = hass.states[e]?.state;
        return s === 'locked' || s === 'closed' || s === 'off';
      });

      const cards: any[] = [];

      if (unlocked.length > 0) {
        cards.push({
          type: 'custom:requinard-security-group-card',
          entities: unlocked,
          heading: localize(`security.${headingKey}${headingKey.includes('smoke') ? '_active' : '_open'}`),
          icon: headingKey.includes('smoke') ? 'mdi:smoke-detector-alert' : icon + '-open',
          tile_features: features,
          batch_action: batchAction,
          group_by_floors: groupByFloors,
          group_by_rooms: groupByRooms,
        });
      }

      if (locked.length > 0) {
        cards.push({
          type: 'custom:requinard-security-group-card',
          entities: locked,
          heading: localize(`security.${headingKey}${headingKey.includes('smoke') ? '_inactive' : '_closed'}`),
          icon: headingKey.includes('smoke') ? 'mdi:smoke-detector' : icon,
          tile_features: features,
          group_by_floors: groupByFloors,
          group_by_rooms: groupByRooms,
        });
      }

      if (cards.length > 0) {
        sections.push({ type: 'grid', cards });
      }
    };

    // Locks
    buildSecuritySection(locks, 'locks', 'mdi:lock', [{ type: 'lock-commands' }], {
      action: 'lock.lock',
      icon: 'mdi:lock',
    });

    // Doors/Gates
    buildSecuritySection(doors, 'doors', 'mdi:door', [{ type: 'cover-open-close' }], {
      action: 'cover.close_cover',
      icon: 'mdi:arrow-down',
    });

    // Garages
    buildSecuritySection(garages, 'garages', 'mdi:garage', [{ type: 'cover-open-close' }], {
      action: 'cover.close_cover',
      icon: 'mdi:arrow-down',
    });

    // Windows/Openings
    buildSecuritySection(windows, 'windows', 'mdi:window');

    // Smoke/Gas detectors
    buildSecuritySection(smokeGas, 'smoke_gas', 'mdi:smoke-detector');

    return { type: 'sections', sections };
  }
}

customElements.define('ll-strategy-requinard-view-security', RequinardViewSecurityStrategy);
