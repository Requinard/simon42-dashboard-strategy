// ====================================================================
// CLIMATE GROUP CARD — Reactive card for climate/thermostat groups
// ====================================================================

import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import type { HomeAssistant } from '../types/homeassistant';
import { Registry } from '../Registry';
import { localize } from '../utils/localize';
import { groupByFloors, groupByRooms } from '../utils/grouping-utils';

interface ClimateGroupConfig {
  config?: any;
  hvac_status: 'heating' | 'cooling' | 'idle' | 'off';
  heading: string;
  icon: string;
  group_by_floors?: boolean;
  group_by_rooms?: boolean;
}

export class ClimateGroupCard extends LitElement {
  static properties = {
    hass: { attribute: false },
  };

  public hass?: HomeAssistant;
  private _config!: ClimateGroupConfig;
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
    .climate-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    .climate-grid {
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

  setConfig(config: ClimateGroupConfig): void {
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
      this._cachedFilteredIds = new Set(this._getFilteredClimateEntities());
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

  private _getFilteredClimateEntities(): string[] {
    if (!this.hass) return [];
    const climateIds = Registry.getVisibleEntityIdsForDomain('climate').filter(
      (id) => this.hass!.states[id] !== undefined
    );

    const relevant: string[] = [];

    for (const id of climateIds) {
      const state = this.hass.states[id];
      const hvacAction = state.attributes?.hvac_action as string | undefined;
      const hvacState = state.state;

      let status: 'heating' | 'cooling' | 'idle' | 'off';

      if (hvacState === 'off' || hvacState === 'unavailable' || hvacState === 'unknown') {
        status = 'off';
      } else if (hvacAction === 'heating' || (!hvacAction && hvacState === 'heat')) {
        status = 'heating';
      } else if (hvacAction === 'cooling' || (!hvacAction && hvacState === 'cool')) {
        status = 'cooling';
      } else {
        status = 'idle';
      }

      if (status === this._config.hvac_status) {
        relevant.push(id);
      }
    }

    return relevant;
  }

  protected render() {
    if (!this.hass || !this._cachedFilteredIds) return nothing;

    const items = Array.from(this._cachedFilteredIds);
    if (items.length === 0) {
      this.hidden = true;
      return nothing;
    }
    this.hidden = false;

    if (this._config.group_by_rooms) {
      const roomGroups = groupByRooms(this.hass, items, (id) => id);
      return html`
        <div class="climate-section">
          <div id="heading"></div>
          ${roomGroups.map((group) => {
            const roomKey = group.roomId ?? '_none';
            return html`
              <div class="room-section">
                <div id=${`room-heading-${roomKey}`}></div>
                <div class="climate-grid" id=${`room-grid-${roomKey}`}></div>
              </div>
            `;
          })}
        </div>
      `;
    }

    if (this._config.group_by_floors) {
      const floorGroups = groupByFloors(this.hass, items, (id) => id);
      return html`
        <div class="climate-section">
          <div id="heading"></div>
          ${floorGroups.map((group) => {
            const floorKey = group.floorId ?? '_none';
            return html`
              <div class="floor-section">
                <div id=${`floor-heading-${floorKey}`}></div>
                <div class="climate-grid" id=${`floor-grid-${floorKey}`}></div>
              </div>
            `;
          })}
        </div>
      `;
    }

    return html`
      <div class="climate-section">
        <div id="heading"></div>
        <div class="climate-grid" id="grid"></div>
      </div>
    `;
  }

  protected updated() {
    if (!this.hass || !this._cachedFilteredIds) return;

    const items = Array.from(this._cachedFilteredIds);
    const allActiveIds = new Set(items);

    if (this._config.group_by_rooms) {
      const roomGroups = groupByRooms(this.hass, items, (id) => id);
      const headingSlot = this.shadowRoot?.getElementById('heading');
      if (headingSlot) {
        if (!this._headingCard) {
          this._headingCard = document.createElement('hui-heading-card');
          this._headingCard.setConfig(this._buildMainHeadingConfig(items.length));
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
      const floorGroups = groupByFloors(this.hass, items, (id) => id);
      const headingSlot = this.shadowRoot?.getElementById('heading');
      if (headingSlot) {
        if (!this._headingCard) {
          this._headingCard = document.createElement('hui-heading-card');
          this._headingCard.setConfig(this._buildMainHeadingConfig(items.length));
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
      this._headingCard.setConfig(this._buildMainHeadingConfig(items.length));
      if (this._headingCard.parentNode !== headingSlot) {
        headingSlot.replaceChildren(this._headingCard);
      }
      this._headingCard.hass = this.hass;
    }

    const grid = this.shadowRoot?.getElementById('grid');
    if (grid) this._reconcileGrid(grid, items);

    this._cleanupPools(allActiveIds);
  }

  private _buildMainHeadingConfig(count: number) {
    return {
      type: 'heading',
      heading: `${this._config.heading} (${count})`,
      heading_style: 'title',
      icon: this._config.icon,
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
      features: [{ type: 'climate-hvac-modes' }],
      features_position: 'inline',
      state_content: ['hvac_action', 'current_temperature'],
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
    entityIds.forEach((id, idx) => {
      const card = this._getOrCreateTileCard(id);
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

customElements.define('requinard-climate-group-card', ClimateGroupCard);
