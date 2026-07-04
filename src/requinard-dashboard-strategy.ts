// ====================================================================
// REQUINARD DASHBOARD STRATEGY — Main Entry Point
// ====================================================================
// Minimal entry point for fast custom element registration.
// Cards, views, and heavy dependencies are lazy-loaded in generate().
// This ensures customElements.define() runs before HA's 5s timeout.
// ====================================================================

import type { HomeAssistant } from './types/homeassistant';
import type { RequinardStrategyConfig } from './types/strategy';
import type { LovelaceConfig, LovelaceViewConfig } from './types/lovelace';

const STRATEGY_VERSION = '1.4.0';

const DEBUG = new URLSearchParams(window.location.search).has('req_debug');
const T0 = performance.now();
const t = (label: string) => {
  if (DEBUG) console.log(`[req-timing] ${label}: ${(performance.now() - T0).toFixed(0)}ms`);
};
let generateCallCount = 0;

import { SummaryCard } from './cards/SummaryCard';
import { LightsGroupCard } from './cards/LightsGroupCard';
import { CoversGroupCard } from './cards/CoversGroupCard';
import { BatteriesGroupCard } from './cards/BatteriesGroupCard';
import { ClimateGroupCard } from './cards/ClimateGroupCard';
import { SecurityGroupCard } from './cards/SecurityGroupCard';
import { OverviewViewStrategy } from './views/OverviewViewStrategy';
import { LightsViewStrategy } from './views/LightsViewStrategy';
import { CoversViewStrategy } from './views/CoversViewStrategy';
import { SecurityViewStrategy } from './views/SecurityViewStrategy';
import { BatteriesViewStrategy } from './views/BatteriesViewStrategy';
import { ClimateViewStrategy } from './views/ClimateViewStrategy';
import { RoomViewStrategy } from './views/RoomViewStrategy';

// We just import them so they are bundled. We don't need to do anything with the imports
// since they register themselves via customElements.define.
[
  SummaryCard,
  LightsGroupCard,
  CoversGroupCard,
  BatteriesGroupCard,
  ClimateGroupCard,
  SecurityGroupCard,
  OverviewViewStrategy,
  LightsViewStrategy,
  CoversViewStrategy,
  SecurityViewStrategy,
  BatteriesViewStrategy,
  ClimateViewStrategy,
  RoomViewStrategy,
];

import { Registry } from './Registry';
import { getVisibleAreasFromHass } from './utils/name-utils';
import { localize } from './utils/localize';

import { RequinardDashboardStrategyEditor } from './editor/StrategyEditor';

class RequinardDashboardStrategy extends HTMLElement {
  static async generate(config: RequinardStrategyConfig, hass: HomeAssistant): Promise<LovelaceConfig> {
    generateCallCount++;
    t(`generate() called (#${generateCallCount})`);

    t('imports done');

    const getStrategy = (tag: string): any => customElements.get(tag);

    Registry.initialize(hass, config);
    t('registry initialized');

    const visibleAreas = getVisibleAreasFromHass(hass, config.areas_display, config.use_default_area_sort);

    const showSummaryViews = config.show_summary_views === true;
    const showRoomViews = config.show_room_views === true;
    const showLights = config.show_light_summary !== false;
    const showCovers = config.show_covers_summary !== false;
    const showSecurity = config.show_security_summary !== false;
    const showBatteries = config.show_battery_summary !== false;
    const showClimate = config.show_climate_summary === true;

    // Pre-resolve ALL views upfront (like HA's Home Panel does)
    const overviewConfig = await getStrategy('ll-strategy-requinard-view-overview').generate(
      { dashboardConfig: config },
      hass
    );
    t('overview resolved');

    // Only resolve utility views for enabled summaries
    const utilityViewDefs = [
      { enabled: showLights, title: localize('views.lights'), path: 'lights', icon: 'mdi:lamps',
        resolve: () => getStrategy('ll-strategy-requinard-view-lights').generate({ config }, hass) },
      { enabled: showCovers, title: localize('views.covers'), path: 'covers', icon: 'mdi:blinds-horizontal',
        resolve: () => getStrategy('ll-strategy-requinard-view-covers').generate(
          { device_classes: ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window'], config }, hass) },
      { enabled: showSecurity, title: localize('views.security'), path: 'security', icon: 'mdi:security',
        resolve: () => getStrategy('ll-strategy-requinard-view-security').generate({ config }, hass) },
      { enabled: showBatteries, title: localize('views.batteries'), path: 'batteries', icon: 'mdi:battery-alert',
        resolve: () => getStrategy('ll-strategy-requinard-view-batteries').generate({ config }, hass) },
      { enabled: showClimate, title: localize('views.climate'), path: 'climate', icon: 'mdi:thermostat',
        resolve: () => getStrategy('ll-strategy-requinard-view-climate').generate({ config }, hass) },
    ];

    const enabledDefs = utilityViewDefs.filter((d) => d.enabled);
    const utilityConfigs = await Promise.all(enabledDefs.map((d) => d.resolve()));
    t('utility views resolved');

    const roomStrategy = getStrategy('ll-strategy-requinard-view-room');
    const roomConfigs = await Promise.all(
      visibleAreas.map((area) => {
        const areaOptions = config.areas_options?.[area.area_id];
        return roomStrategy.generate(
          {
            area,
            groups_options: areaOptions?.groups_options || {},
            dashboardConfig: config,
          },
          hass
        );
      })
    );
    t(`${visibleAreas.length} room views resolved`);

    const views: LovelaceViewConfig[] = [
      {
        title: localize('views.overview'),
        path: 'home',
        icon: 'mdi:home',
        ...overviewConfig,
      },
      ...enabledDefs.map((def, i) => ({
        title: def.title,
        path: def.path,
        icon: def.icon,
        subview: !showSummaryViews,
        ...utilityConfigs[i],
      })),
      ...visibleAreas.map((area, i) => ({
        title: area.name,
        path: area.area_id,
        icon: area.icon || 'mdi:floor-plan',
        subview: !showRoomViews,
        ...roomConfigs[i],
      })),
    ];

    const customViews = config.custom_views || [];
    for (const cv of customViews) {
      if (cv.parsed_config && cv.title && cv.path) {
        views.push({
          ...cv.parsed_config,
          title: cv.title,
          path: cv.path,
          icon: cv.icon || 'mdi:card-text-outline',
        });
      }
    }

    t(`generate() done — ${views.length} views`);

    return {
      title: localize('dashboard.title'),
      views,
    };
  }

  static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('requinard-dashboard-strategy-editor');
  }
}

// Register strategy custom element IMMEDIATELY — no heavy imports needed.
// This ensures HA's 5-second timeout is satisfied even on slow networks.
customElements.define('ll-strategy-requinard-dashboard', RequinardDashboardStrategy);

console.log(`Requinard Dashboard Strategy v${STRATEGY_VERSION} loaded`);
