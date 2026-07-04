import type { HomeAssistant } from '../types/homeassistant';
import type { AreaRegistryEntry, FloorRegistryEntry } from '../types/registries';
import { Registry } from '../Registry';
import { localize } from './localize';

export interface FloorGroup<T> {
  floorId: string | null;
  floorName: string;
  floorIcon: string;
  items: T[];
}

export interface RoomGroup<T> {
  roomId: string | null;
  roomName: string;
  roomIcon: string;
  items: T[];
}

export function getAreaForEntity(entityId: string): string | null {
  const entity = Registry.getEntity(entityId);
  let areaId: string | null = entity?.area_id ?? null;
  if (!areaId && entity?.device_id) {
    const device = Registry.getDevice(entity.device_id);
    areaId = device?.area_id ?? null;
  }
  return areaId;
}

export function groupByFloors<T>(
  hass: HomeAssistant,
  items: T[],
  getEntityId: (item: T) => string
): FloorGroup<T>[] {
  const areas: AreaRegistryEntry[] = Object.values(hass.areas);
  const areaFloorMap = new Map<string, string | null>();
  for (const area of areas) {
    areaFloorMap.set(area.area_id, area.floor_id ?? null);
  }

  const floorMap = new Map<string | null, T[]>();
  for (const item of items) {
    const entityId = getEntityId(item);
    const areaId = getAreaForEntity(entityId);
    const floorId = areaId ? (areaFloorMap.get(areaId) ?? null) : null;
    if (!floorMap.has(floorId)) floorMap.set(floorId, []);
    floorMap.get(floorId)?.push(item);
  }

  const floors = hass.floors as Record<string, FloorRegistryEntry>;
  const floorOrder = Object.keys(floors);
  const sortedKeys = [...floorOrder.filter((id) => floorMap.has(id)), ...(floorMap.has(null) ? [null] : [])];

  return sortedKeys.map((floorId) => {
    const floor = floorId ? floors[floorId] : null;
    return {
      floorId,
      floorName: floor?.name || localize('lights.floor_other'),
      floorIcon: floor?.icon || 'mdi:home-outline',
      items: floorMap.get(floorId) ?? [],
    };
  });
}

export function groupByRooms<T>(
  hass: HomeAssistant,
  items: T[],
  getEntityId: (item: T) => string
): RoomGroup<T>[] {
  const areas = hass.areas;
  const roomMap = new Map<string | null, T[]>();

  for (const item of items) {
    const entityId = getEntityId(item);
    const areaId = getAreaForEntity(entityId);
    if (!roomMap.has(areaId)) roomMap.set(areaId, []);
    roomMap.get(areaId)?.push(item);
  }

  const floorOrder = hass.floors ? Object.keys(hass.floors) : [];

  const sortedAreaIds = Array.from(roomMap.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;

    const areaA = areas[a];
    const areaB = areas[b];

    if (!areaA || !areaB) return 0;

    if (areaA.floor_id !== areaB.floor_id) {
      if (!areaA.floor_id) return 1;
      if (!areaB.floor_id) return -1;
      const indexA = floorOrder.indexOf(areaA.floor_id);
      const indexB = floorOrder.indexOf(areaB.floor_id);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    }

    return areaA.name.localeCompare(areaB.name);
  });

  return sortedAreaIds.map((areaId) => {
    const area = areaId ? areas[areaId] : null;
    return {
      roomId: areaId,
      roomName: area?.name || localize('lights.room_other'),
      roomIcon: area?.icon || 'mdi:room-service-outline',
      items: roomMap.get(areaId) ?? [],
    };
  });
}
