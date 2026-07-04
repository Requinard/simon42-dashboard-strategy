// ====================================================================
// COVERS GROUP CARD — Reactive card for open/closed cover groups (LitElement)
// ====================================================================

import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import type { HomeAssistant } from '../types/homeassistant';
import type { AreaRegistryEntry } from '../types/registries';
import { Registry } from '../Registry';
import { trackHassUpdate } from '../utils/debug';
import { groupByFloors, groupByRooms } from '../utils/grouping-utils';
import { localize } from '../utils/localize';

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string }>;
  }
}

interface CoversGroupConfig {
  config?: any;
  group_type: 'open' | 'closed' | 'partially_open';
  group_by_floors?: boolean;
  group_by_rooms?: boolean;
  show_partially_open?: boolean;
  device_classes?: string[];
  heading_open?: string;
  heading_closed?: string;
  heading_partial?: string;
  batch_open_text?: string;
  batch_close_text?: string;
}

interface FloorGroup {
  floorId: string | null;
  floorName: string;
  floorIcon: string;
  covers: string[];
}

interface RoomGroup {
  roomId: string | null;
  roomName: string;
  roomIcon: string;
  covers: string[];
}

// Pre-compiled RegExps for cover type name stripping
const COVER_TERMS = [
  'Rollo',
  'Rollladen',
  'Jalousie',
  'Vorhang',
  'Gardine',
  'Rolladen',
  'Beschattung',
  'Raffstore',
  'Fenster',
  'Cover',
  'Blind',
  'Curtain',
  'Shade',
  'Shutter',
  'Window',
  'Markise',
  'Awning',
];
const COVER_TERM_REGEXPS = COVER_TERMS.map((term) => new RegExp(`^${term}\\s+|\\s+${term}$`, 'gi'));

const DEFAULT_DEVICE_CLASSES = ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window'];

class RequinardCoversGroupCard extends LitElement {
  static properties = {
    hass: { attribute: false },
  };

  public hass?: HomeAssistant;
  private _config!: CoversGroupConfig;
  private _deviceClasses!: string[];
  private _cachedFilteredIds: Set<string> | null = null;
  private _cachedAreaForEntity: Map<string, string | null> | null = null;
  private _lastCoversList = '';

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
    .covers-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    .cover-grid {
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

  setConfig(config: CoversGroupConfig): void {
    this._config = config;
    this._deviceClasses = config.device_classes || DEFAULT_DEVICE_CLASSES;
  }

  protected willUpdate(changedProps: PropertyValues): void {
    if (!changedProps.has('hass') || !this.hass) return;

    trackHassUpdate('covers-group');
    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;

    if (!oldHass || oldHass.entities !== this.hass.entities) {
      this._cachedFilteredIds = null;
      this._cachedAreaForEntity = null;
    }

    // Build cache if needed
    if (!this._cachedFilteredIds) {
      if (!Registry.initialized) return;
      this._cachedFilteredIds = new Set(this._getFilteredCoverEntities(this.hass));
    }

    // Always propagate hass to child cards
    this._propagateHass(this.hass);
  }

  private _propagateHass(hass: HomeAssistant): void {
    if (this._headingCard) this._headingCard.hass = hass;
    for (const card of this._tileCards.values()) {
      card.hass = hass;
    }
  }

  private _getFilteredCoverEntities(hass: HomeAssistant): string[] {
    return Registry.getVisibleEntityIdsForDomain('cover').filter((id) => {
      const state = hass.states[id];
      if (!state) return false;
      const deviceClass = (state.attributes as any)?.device_class as string | undefined;
      // Covers without device_class only match the main group (multiple classes), not specialized groups like awnings/windows
      if (!deviceClass) return this._deviceClasses.length > 1;
      return this._deviceClasses.includes(deviceClass);
    });
  }

  private _getRelevantCovers(): string[] {
    if (!this.hass || !this._cachedFilteredIds) return [];
    const groupType = this._config.group_type;
    const showPartiallyOpen = this._config.show_partially_open === true;

    const relevant: string[] = [];
    for (const id of this._cachedFilteredIds) {
      const state = this.hass.states[id];
      if (!state) continue;

      const position = (state.attributes as any)?.current_position;
      const hasPosition = typeof position === 'number';
      const isMoving = state.state === 'opening' || state.state === 'closing';

      if (groupType === 'partially_open') {
        // Partially open: position between 0 and 100 (open or currently moving)
        if (state.state === 'open' || isMoving) {
          if (hasPosition && position > 0 && position < 100) {
            relevant.push(id);
          }
        }
      } else if (groupType === 'open') {
        if (state.state === 'open' || state.state === 'opening') {
          if (showPartiallyOpen) {
            // Only fully open (100%) or covers without position attribute
            if (!hasPosition || position >= 100) {
              relevant.push(id);
            }
          } else {
            relevant.push(id);
          }
        }
      } else {
        if (state.state === 'closed') {
          relevant.push(id);
        } else if (state.state === 'closing') {
          // When partially_open is active, closing covers with position > 0 belong to partially_open
          if (showPartiallyOpen && hasPosition && position > 0) continue;
          relevant.push(id);
        }
      }
    }

    relevant.sort((a, b) => {
      const stateA = this.hass?.states[a];
      const stateB = this.hass?.states[b];
      if (!stateA || !stateB) return 0;
      return new Date(stateB.last_changed).getTime() - new Date(stateA.last_changed).getTime();
    });

    return relevant;
  }

  private _stripCoverType(entityId: string): string {
    const state = this.hass?.states[entityId];
    if (!state) return entityId;

    let name = state.attributes.friendly_name || entityId;

    for (const regex of COVER_TERM_REGEXPS) {
      regex.lastIndex = 0;
      name = name.replace(regex, '');
    }

    return name.trim() || state.attributes.friendly_name || entityId;
  }

  private _getAreaForEntity(entityId: string): string | null {
    if (!this._cachedAreaForEntity) {
      this._cachedAreaForEntity = new Map();
    }
    if (this._cachedAreaForEntity.has(entityId)) {
      return this._cachedAreaForEntity.get(entityId) ?? null;
    }
    const entity = Registry.getEntity(entityId);
    let areaId: string | null = entity?.area_id ?? null;
    if (!areaId && entity?.device_id) {
      const device = Registry.getDevice(entity.device_id);
      areaId = device?.area_id ?? null;
    }
    this._cachedAreaForEntity.set(entityId, areaId);
    return areaId;
  }

  private _groupByFloors(covers: string[]): FloorGroup[] {
    if (!this.hass) return [];
    return groupByFloors(this.hass, covers, (id) => id).map((g) => ({
      floorId: g.floorId,
      floorName: g.floorName,
      floorIcon: g.floorIcon,
      covers: g.items,
    }));
  }

  private _groupByRooms(covers: string[]): RoomGroup[] {
    if (!this.hass) return [];
    return groupByRooms(this.hass, covers, (id) => id).map((g) => ({
      roomId: g.roomId,
      roomName: g.roomName,
      roomIcon: g.roomIcon,
      covers: g.items,
    }));
  }

  private _buildHeadingConfig(covers: string[]): any {
    const groupType = this._config.group_type;
    const openText = this._config.batch_open_text || localize('covers.open_all');
    const closeText = this._config.batch_close_text || localize('covers.close_all');

    if (groupType === 'partially_open') {
      const headingLabel = this._config.heading_partial || localize('covers.partially_open');
      return {
        type: 'heading',
        heading: `${headingLabel} (${covers.length})`,
        icon: 'mdi:blinds-horizontal',
        badges: [
          {
            type: 'button',
            icon: 'mdi:arrow-up',
            text: openText,
            tap_action: {
              action: 'perform-action',
              perform_action: 'cover.open_cover',
              target: { entity_id: covers },
            },
          },
          {
            type: 'button',
            icon: 'mdi:arrow-down',
            text: closeText,
            tap_action: {
              action: 'perform-action',
              perform_action: 'cover.close_cover',
              target: { entity_id: covers },
            },
          },
        ],
      };
    }

    const isOpen = groupType === 'open';
    const headingLabel = isOpen
      ? (this._config.heading_open || localize('covers.open'))
      : (this._config.heading_closed || localize('covers.closed'));
    return {
      type: 'heading',
      heading: `${headingLabel} (${covers.length})`,
      icon: isOpen ? 'mdi:blinds-horizontal' : 'mdi:blinds',
      badges: [
        {
          type: 'button',
          icon: isOpen ? 'mdi:arrow-down' : 'mdi:arrow-up',
          text: isOpen ? closeText : openText,
          tap_action: {
            action: 'perform-action',
            perform_action: isOpen ? 'cover.close_cover' : 'cover.open_cover',
            target: { entity_id: covers },
          },
        },
      ],
    };
  }

  private _getOrCreateTileCard(entityId: string): any {
    let card = this._tileCards.get(entityId);
    if (card) return card;

    card = document.createElement('hui-tile-card');
    card.hass = this.hass;
    card.setConfig({
      type: 'tile',
      entity: entityId,
      name: this._stripCoverType(entityId),
      features: [{ type: 'cover-open-close' }],
      vertical: false,
      features_position: 'inline',
      state_content: ['current_position', 'last_changed'],
    });
    this._tileCards.set(entityId, card);
    return card;
  }

  private _getOrCreateRoomHeadingCard(key: string): any {
    let card = this._floorHeadingCards.get(`room-${key}`);
    if (card) return card;
    card = document.createElement('hui-heading-card');
    card.hass = this.hass;
    this._floorHeadingCards.set(`room-${key}`, card);
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

  private _getRoomDomKey(roomId: string | null): string {
    return roomId ?? '_none';
  }

  private _getFloorDomKey(floorId: string | null): string {
    return floorId ?? '_none';
  }

  private _calculateRenderKey(covers: string[]): string {
    return covers
      .map((id) => {
        const state = this.hass?.states[id];
        if (!state) return id;
        const position = (state.attributes as any)?.current_position;
        if (typeof position === 'number') {
          return `${id}:${state.state}:${position}`;
        }
        return `${id}:${state.state}`;
      })
      .join(',');
  }

  protected render() {
    if (!this.hass || !this._cachedFilteredIds) return nothing;

    const covers = this._getRelevantCovers();
    if (covers.length === 0) {
      this.hidden = true;
      return nothing;
    }
    this.hidden = false;

    if (this._config.group_by_rooms) {
      const roomGroups = this._groupByRooms(covers);
      return html`
        <div class="covers-section">
          <div id="heading"></div>
          ${roomGroups.map((group) => {
            const roomKey = this._getRoomDomKey(group.roomId);
            return html`
              <div class="room-section">
                <div id=${`room-heading-${roomKey}`}></div>
                <div class="cover-grid" id=${`room-grid-${roomKey}`}></div>
              </div>
            `;
          })}
        </div>
      `;
    }

    if (this._config.group_by_floors) {
      const floorGroups = this._groupByFloors(covers);
      return html`
        <div class="covers-section">
          <div id="heading"></div>
          ${floorGroups.map((group) => {
            const floorKey = this._getFloorDomKey(group.floorId);
            return html`
              <div class="floor-section">
                <div id=${`floor-heading-${floorKey}`}></div>
                <div class="cover-grid" id=${`floor-grid-${floorKey}`}></div>
              </div>
            `;
          })}
        </div>
      `;
    }

    return html`
      <div class="covers-section">
        <div id="heading"></div>
        <div class="cover-grid" id="grid"></div>
      </div>
    `;
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (!this.hass || !this._cachedFilteredIds) return;

    const covers = this._getRelevantCovers();
    const coversKey = this._calculateRenderKey(covers);
    if (this._lastCoversList === coversKey) return;
    this._lastCoversList = coversKey;

    if (this._config.group_by_rooms) {
      const roomGroups = this._groupByRooms(covers);
      const allActiveIds = new Set(covers);

      for (const group of roomGroups) {
        const key = this._getRoomDomKey(group.roomId);
        const roomHeadingSlot = this.shadowRoot?.getElementById(`room-heading-${key}`);
        if (roomHeadingSlot) {
          const headingCard = this._getOrCreateRoomHeadingCard(key);
          if (!headingCard.parentNode) roomHeadingSlot.appendChild(headingCard);
          headingCard.hass = this.hass;
          headingCard.setConfig(this._buildHeadingConfig(group.covers));
        }

        const grid = this.shadowRoot?.getElementById(`room-grid-${key}`);
        if (grid) {
          this._reconcileGrid(grid, group.covers);
        }
      }

      this._cleanupPools(allActiveIds);
      return;
    }

    if (this._config.group_by_floors) {
      const floorGroups = this._groupByFloors(covers);
      const allActiveIds = new Set(covers);

      for (const group of floorGroups) {
        const key = this._getFloorDomKey(group.floorId);
        const floorHeadingSlot = this.shadowRoot?.getElementById(`floor-heading-${key}`);
        if (floorHeadingSlot) {
          const headingCard = this._getOrCreateFloorHeadingCard(key);
          if (!headingCard.parentNode) floorHeadingSlot.appendChild(headingCard);
          headingCard.hass = this.hass;
          headingCard.setConfig(this._buildHeadingConfig(group.covers));
        }

        const grid = this.shadowRoot?.getElementById(`floor-grid-${key}`);
        if (grid) {
          this._reconcileGrid(grid, group.covers);
        }
      }

      this._cleanupPools(allActiveIds);
      return;
    }

    // Flat mode (no floor grouping)
    const headingSlot = this.shadowRoot?.getElementById('heading');
    if (headingSlot) {
      if (!this._headingCard) {
        this._headingCard = document.createElement('hui-heading-card');
        headingSlot.appendChild(this._headingCard);
      }
      this._headingCard.hass = this.hass;
      this._headingCard.setConfig(this._buildHeadingConfig(covers));
    }

    const grid = this.shadowRoot?.getElementById('grid');
    if (grid) {
      this._reconcileGrid(grid, covers);
    }
    this._cleanupPools(new Set(covers));
  }

  private _reconcileGrid(grid: HTMLElement, covers: string[]): void {
    // Add/reorder cards to match the desired order
    let prevNode: Node | null = null;
    for (const entityId of covers) {
      const card = this._getOrCreateTileCard(entityId);
      const nextSibling = prevNode ? prevNode.nextSibling : grid.firstChild;
      if (card !== nextSibling) {
        grid.insertBefore(card, nextSibling);
      }
      prevNode = card;
    }

    // Remove trailing stale nodes
    while (prevNode && prevNode.nextSibling) {
      grid.removeChild(prevNode.nextSibling);
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

  getCardSize(): number {
    const covers = this._getRelevantCovers();
    return Math.ceil(covers.length / 3) + 1;
  }
}

customElements.define('requinard-covers-group-card', RequinardCoversGroupCard);
