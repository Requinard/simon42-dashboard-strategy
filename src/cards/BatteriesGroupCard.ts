// ====================================================================
// BATTERIES GROUP CARD — Reactive card for battery status groups
// ====================================================================

import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import type { HomeAssistant } from '../types/homeassistant';
import { Registry } from '../Registry';
import { localize } from '../utils/localize';
import { getBatteryEntities } from '../utils/entity-filter';
import { groupByFloors, groupByRooms } from '../utils/grouping-utils';

interface BatteriesGroupConfig {
  config?: any;
  status: 'critical' | 'low' | 'good';
  range_text: string;
  color: string;
  group_by_floors?: boolean;
  group_by_rooms?: boolean;
}

export class BatteriesGroupCard extends LitElement {
  static properties = {
    hass: { attribute: false },
  };

  public hass?: HomeAssistant;
  private _config!: BatteriesGroupConfig;
  private _cachedFilteredIds: Set<string> | null = null;

  // Reusable card pool
  private _tileCards: Map<string, any> = new Map();
  private _headingCard: any = null;
  private _floorHeadingCards: Map<string, any> = new Map();

  static styles = css`
    :host {
      display: block;
    }
    :host([hidden]) {
      display: none;
    }
    .batteries-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    .battery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 8px;
    }
    .floor-section,
    .room-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  `;

  setConfig(config: BatteriesGroupConfig): void {
    this._config = config;
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (!changedProps.has('hass') || !this.hass) return;

    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;

    if (!oldHass || oldHass.entities !== this.hass.entities) {
      this._cachedFilteredIds = null;
    }

    if (!this._cachedFilteredIds) {
      if (!Registry.initialized) return;
      this._cachedFilteredIds = new Set(this._getFilteredBatteryEntities());
    }

    this._propagateHass(this.hass);
  }

  private _propagateHass(hass: HomeAssistant): void {
    if (this._headingCard) this._headingCard.hass = hass;
    for (const card of this._tileCards.values()) {
      card.hass = hass;
    }
    for (const card of this._floorHeadingCards.values()) {
      card.hass = hass;
    }
  }

  private _getFilteredBatteryEntities(): string[] {
    if (!this.hass) return [];
    const batteryEntities = getBatteryEntities(this.hass, this._config.config);
    const criticalThreshold = this._config.config?.battery_critical_threshold ?? 20;
    const lowThreshold = this._config.config?.battery_low_threshold ?? 50;

    const relevant: string[] = [];

    for (const id of batteryEntities) {
      const state = this.hass.states[id];
      if (!state) continue;

      let status: 'critical' | 'low' | 'good';
      if (id.startsWith('binary_sensor.')) {
        status = state.state === 'on' ? 'critical' : 'good';
      } else {
        const value = parseFloat(state.state);
        const unit = state.attributes?.unit_of_measurement;
        if (unit && unit !== '%') continue;
        if (isNaN(value)) status = 'critical';
        else if (value < criticalThreshold) status = 'critical';
        else if (value <= lowThreshold) status = 'low';
        else status = 'good';
      }

      if (status === this._config.status) {
        relevant.push(id);
      }
    }

    // Sort by level
    relevant.sort((a, b) => {
      const valA = parseFloat(this.hass!.states[a]?.state);
      const valB = parseFloat(this.hass!.states[b]?.state);
      if (isNaN(valA)) return -1;
      if (isNaN(valB)) return 1;
      return valA - valB;
    });

    return relevant;
  }

  protected render() {
    if (!this.hass || !this._cachedFilteredIds) return nothing;

    const batteries = Array.from(this._cachedFilteredIds);
    if (batteries.length === 0) {
      this.hidden = true;
      return nothing;
    }
    this.hidden = false;

    if (this._config.group_by_rooms) {
      const roomGroups = groupByRooms(this.hass, batteries, (id) => id);
      return html`
        <div class="batteries-section">
          <div id="heading"></div>
          ${roomGroups.map((group) => {
            const roomKey = group.roomId ?? '_none';
            return html`
              <div class="room-section">
                <div id=${`room-heading-${roomKey}`}></div>
                <div class="battery-grid" id=${`room-grid-${roomKey}`}></div>
              </div>
            `;
          })}
        </div>
      `;
    }

    if (this._config.group_by_floors) {
      const floorGroups = groupByFloors(this.hass, batteries, (id) => id);
      return html`
        <div class="batteries-section">
          <div id="heading"></div>
          ${floorGroups.map((group) => {
            const floorKey = group.floorId ?? '_none';
            return html`
              <div class="floor-section">
                <div id=${`floor-heading-${floorKey}`}></div>
                <div class="battery-grid" id=${`floor-grid-${floorKey}`}></div>
              </div>
            `;
          })}
        </div>
      `;
    }

    return html`
      <div class="batteries-section">
        <div id="heading"></div>
        <div class="battery-grid" id="grid"></div>
      </div>
    `;
  }

  protected updated() {
    if (!this.hass || !this._cachedFilteredIds) return;

    const batteries = Array.from(this._cachedFilteredIds);
    const allActiveIds = new Set(batteries);

    if (this._config.group_by_rooms) {
      const roomGroups = groupByRooms(this.hass, batteries, (id) => id);
      const headingSlot = this.shadowRoot?.getElementById('heading');
      if (headingSlot) {
        if (!this._headingCard) {
          this._headingCard = document.createElement('hui-heading-card');
          this._headingCard.setConfig(this._buildMainHeadingConfig(batteries.length));
        }
        if (this._headingCard.parentNode !== headingSlot) {
          headingSlot.replaceChildren(this._headingCard);
        }
        this._headingCard.hass = this.hass;
      }

      for (const group of roomGroups) {
        const key = group.roomId ?? '_none';
        const headingSlot = this.shadowRoot?.getElementById(`room-heading-${key}`);
        if (headingSlot) {
          const card = this._getOrCreateFloorHeadingCard(`room-${key}`);
          card.setConfig({
            type: 'heading',
            heading: group.roomName,
            icon: group.roomIcon,
            heading_style: 'subtitle',
          });
          if (card.parentNode !== headingSlot) headingSlot.replaceChildren(card);
        }

        const grid = this.shadowRoot?.getElementById(`room-grid-${key}`);
        if (grid) this._reconcileGrid(grid, group.items);
      }
      this._cleanupPools(allActiveIds);
      return;
    }

    if (this._config.group_by_floors) {
      const floorGroups = groupByFloors(this.hass, batteries, (id) => id);
      const headingSlot = this.shadowRoot?.getElementById('heading');
      if (headingSlot) {
        if (!this._headingCard) {
          this._headingCard = document.createElement('hui-heading-card');
          this._headingCard.setConfig(this._buildMainHeadingConfig(batteries.length));
        }
        if (this._headingCard.parentNode !== headingSlot) {
          headingSlot.replaceChildren(this._headingCard);
        }
        this._headingCard.hass = this.hass;
      }

      for (const group of floorGroups) {
        const key = group.floorId ?? '_none';
        const headingSlot = this.shadowRoot?.getElementById(`floor-heading-${key}`);
        if (headingSlot) {
          const card = this._getOrCreateFloorHeadingCard(key);
          card.setConfig({
            type: 'heading',
            heading: group.floorName,
            icon: group.floorIcon,
            heading_style: 'subtitle',
          });
          if (card.parentNode !== headingSlot) headingSlot.replaceChildren(card);
        }

        const grid = this.shadowRoot?.getElementById(`floor-grid-${key}`);
        if (grid) this._reconcileGrid(grid, group.items);
      }
      this._cleanupPools(allActiveIds);
      return;
    }

    const headingSlot = this.shadowRoot?.getElementById('heading');
    if (headingSlot) {
      if (!this._headingCard) {
        this._headingCard = document.createElement('hui-heading-card');
      }
      this._headingCard.setConfig(this._buildMainHeadingConfig(batteries.length));
      if (this._headingCard.parentNode !== headingSlot) {
        headingSlot.replaceChildren(this._headingCard);
      }
      this._headingCard.hass = this.hass;
    }

    const grid = this.shadowRoot?.getElementById('grid');
    if (grid) this._reconcileGrid(grid, batteries);

    this._cleanupPools(allActiveIds);
  }

  private _buildMainHeadingConfig(count: number) {
    const emoji = this._config.status === 'critical' ? '🔴' : this._config.status === 'low' ? '🟡' : '🟢';
    return {
      type: 'heading',
      heading: `${emoji} ${localize('batteries.' + this._config.status)} (${this._config.range_text}) - ${count} ${
        localize(count === 1 ? 'batteries.battery_one' : 'batteries.battery_many')
      }`,
      heading_style: 'title',
    };
  }

  private _getOrCreateTileCard(entityId: string): any {
    let card = this._tileCards.get(entityId);
    if (card) return card;

    card = document.createElement('hui-tile-card');
    card.setConfig({
      type: 'tile',
      entity: entityId,
      vertical: false,
      state_content: ['state', 'last_changed'],
      color: this._config.color,
    });
    card.hass = this.hass;
    this._tileCards.set(entityId, card);
    return card;
  }

  private _getOrCreateFloorHeadingCard(key: string): any {
    let card = this._floorHeadingCards.get(key);
    if (card) return card;
    card = document.createElement('hui-heading-card');
    card.hass = this.hass;
    this._floorHeadingCards.set(key, card);
    return card;
  }

  private _reconcileGrid(grid: HTMLElement, entityIds: string[]): void {
    const currentNodes = Array.from(grid.children);
    const targetNodes = entityIds.map((id) => this._getOrCreateTileCard(id));

    entityIds.forEach((id, idx) => {
      const card = targetNodes[idx];
      if (grid.children[idx] !== card) {
        grid.insertBefore(card, grid.children[idx] || null);
      }
    });

    while (grid.children.length > entityIds.length) {
      grid.removeChild(grid.lastChild!);
    }
  }

  private _cleanupPools(allActiveIds: Set<string>): void {
    for (const [id, card] of this._tileCards) {
      if (!allActiveIds.has(id)) {
        if (card.parentNode) card.parentNode.removeChild(card);
        this._tileCards.delete(id);
      }
    }
  }
}

customElements.define('requinard-batteries-group-card', BatteriesGroupCard);
