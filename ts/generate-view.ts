import {
    ACTIVE_KEY,
    CODE_EVENT_KEY,
    CODE_SENSOR_KEY,
    CONDITION_KEYS,
    DIVIDER_CARD,
    FOLD_ENTITY_ROW_SEARCH_STRING,
    IN_SYNC_KEY,
    KEY_ORDER
} from './const';
import {
    EntityRegistryEntry,
    HomeAssistant,
    LovelaceCardConfig,
    LovelaceResource,
    LovelaceViewConfig
} from './ha_type_stubs';
import { slugify } from './slugify';
import {
    ConfigEntryJSONFragment,
    LockCodeManagerConfigEntryData,
    LockCodeManagerEntityEntry,
    SlotMapping
} from './types';
import { capitalize } from './util';

export async function generateView(
    hass: HomeAssistant,
    configEntry: ConfigEntryJSONFragment,
    entities: EntityRegistryEntry[],
    include_code_slot_sensors: boolean,
    include_in_sync_sensors: boolean
): Promise<LovelaceViewConfig> {
    console.log('Initial entities:', entities);
    console.log('Config entry:', configEntry);
    
    const callData = {
        type: 'lock_code_manager/get_config_entry_entities'
    };
    const [configEntryData, lovelaceResources] = await Promise.all([
        hass.callWS<LockCodeManagerConfigEntryData>({
            config_entry_id: configEntry.entry_id,
            type: 'lock_code_manager/get_slot_calendar_data'
        }),
        hass.callWS<LovelaceResource[]>({
            type: 'lovelace/resources'
        })
    ]);
    
    console.log('Config entry data:', configEntryData);
    
    const sortedEntities = entities
        .map((entity) => createLockCodeManagerEntity(entity))
        .sort(compareAndSortEntities);
        
    console.log('Sorted entities:', sortedEntities);
    
    const slots = Object.keys(configEntryData.slots).map((slotNum) => parseInt(slotNum, 10));
    console.log('Slots:', slots);
    
    const slotMappings: SlotMapping[] = slots.map((slotNum) =>
        getSlotMapping(hass, slotNum, sortedEntities, configEntryData)
    );
    
    console.log('Slot mappings:', slotMappings);

    const badges = [
        ...configEntryData.locks.sort((a, b) => a.localeCompare(b)),
        ...sortedEntities
            .filter((entity) => entity.key === 'active')
            .map((entity) => {
                return {
                    entity: entity.entity_id,
                    name: `Slot ${entity.slotNum.toString()} active`,
                    type: 'state-label'
                };
            })
    ];

    const useFoldEntityRow =
        lovelaceResources.filter((resource) => resource.url.includes(FOLD_ENTITY_ROW_SEARCH_STRING))
            .length > 0;

    const cards = slotMappings.map((slotMapping) =>
        generateSlotCard(
            configEntry,
            slotMapping,
            useFoldEntityRow,
            include_code_slot_sensors,
            include_in_sync_sensors
        )
    );

    return {
        badges,
        cards,
        panel: false,
        path: slugify(configEntry.title),
        title: configEntry.title
    };
}

function compareAndSortEntities(
    entityA: LockCodeManagerEntityEntry,
    entityB: LockCodeManagerEntityEntry
): -1 | 1 {
    // sort by slot number
    if (entityA.slotNum < entityB.slotNum) return -1;
    if (entityA.slotNum > entityB.slotNum) return 1;
    // sort by key order
    if (KEY_ORDER.indexOf(entityA.key) < KEY_ORDER.indexOf(entityB.key)) return -1;
    if (KEY_ORDER.indexOf(entityA.key) > KEY_ORDER.indexOf(entityB.key)) return 1;
    // sort code sensors alphabetically based on the lock entity_id
    if (
        entityA.key === entityB.key &&
        [CODE_EVENT_KEY, CODE_SENSOR_KEY, IN_SYNC_KEY].includes(entityA.key) &&
        entityA.lockEntityId < entityB.lockEntityId
    )
        return -1;
    return 1;
}

function createLockCodeManagerEntity(entity: EntityRegistryEntry): LockCodeManagerEntityEntry {
    const split = entity.unique_id.split('|');
    return {
        ...entity,
        key: split[2],
        lockEntityId: split[3],
        slotNum: parseInt(split[1], 10)
    };
}

function generateEntityCards(
    configEntry: ConfigEntryJSONFragment,
    entities: LockCodeManagerEntityEntry[]
): { entity: string }[] {
    // Log the entities we're trying to process
    console.log('Processing entities:', entities);
    
    if (!entities || !Array.isArray(entities)) {
        console.log('No entities or not an array');
        return [];
    }
    
    // Only filter out null/undefined entities, keep empty arrays
    const filteredEntities = entities.filter(entity => entity && entity.entity_id);
    console.log('Filtered entities:', filteredEntities);
    
    return filteredEntities.map((entity) => {
        if ([IN_SYNC_KEY, CODE_SENSOR_KEY].includes(entity.key)) {
            return {
                entity: entity.entity_id
            };
        }
        const entityName = entity.name || entity.original_name || '';
        const name = entityName
            .replace(`Code slot ${entity.slotNum}`, '')
            .replace('  ', ' ')
            .replace('  ', ' ')
            .trim()
            .replace(configEntry.title, '')
            .replace('  ', ' ')
            .replace('  ', ' ')
            .trim();
        return {
            entity: entity.entity_id,
            name: capitalize(name)
        };
    });
}

function generateSlotCard(
    configEntry: ConfigEntryJSONFragment,
    slotMapping: SlotMapping,
    useFoldEntityRow: boolean,
    include_code_slot_sensors: boolean,
    include_in_sync_sensors: boolean
): LovelaceCardConfig {
    console.log(`Generating card for slot ${slotMapping.slotNum}`);
    
    // Create array to hold all entities
    const cardEntities = [];
    
    // Add main entities if available
    const mainEntities = generateEntityCards(configEntry, slotMapping.mainEntities || []);
    if (mainEntities && mainEntities.length > 0) {
        cardEntities.push(...mainEntities);
    }
    
    // Always add a divider
    cardEntities.push(DIVIDER_CARD);
    
    // Add PIN active entity if available
    if (slotMapping.pinActiveEntity && slotMapping.pinActiveEntity.entity_id) {
        cardEntities.push({
            entity: slotMapping.pinActiveEntity.entity_id,
            name: 'PIN active'
        });
    }
    
    // Add PIN last used entity if available
    if (slotMapping.codeEventEntity && slotMapping.codeEventEntity.entity_id) {
        cardEntities.push({
            entity: slotMapping.codeEventEntity.entity_id,
            name: 'PIN last used'
        });
    }
    
    // Add condition cards
    const conditionCards = maybeGenerateFoldEntityRowConditionCard(
        configEntry,
        slotMapping.conditionEntities || [],
        slotMapping.calendarEntityId,
        'Conditions',
        useFoldEntityRow
    );
    
    if (conditionCards && conditionCards.length > 0) {
        cardEntities.push(...conditionCards);
    }
    
    // Add in sync sensors if enabled
    if (include_in_sync_sensors) {
        const inSyncCards = maybeGenerateFoldEntityRowCard(
            configEntry,
            slotMapping.inSyncEntities || [],
            'Locks in sync',
            useFoldEntityRow
        );
        
        if (inSyncCards && inSyncCards.length > 0) {
            cardEntities.push(...inSyncCards);
        }
    }
    
    // Add code slot sensors if enabled
    if (include_code_slot_sensors) {
        const codeSlotCards = maybeGenerateFoldEntityRowCard(
            configEntry,
            slotMapping.codeSensorEntities || [],
            'Code slot sensors',
            useFoldEntityRow
        );
        
        if (codeSlotCards && codeSlotCards.length > 0) {
            cardEntities.push(...codeSlotCards);
        }
    }
    
    console.log(`Card entities for slot ${slotMapping.slotNum}:`, cardEntities);
    
    return {
        cards: [
            {
                content: `## Code Slot ${slotMapping.slotNum}`,
                type: 'markdown'
            },
            {
                entities: cardEntities,
                show_header_toggle: false,
                type: 'entities'
            }
        ],
        type: 'vertical-stack'
    };
}

function getSlotMapping(
    hass: HomeAssistant,
    slotNum: number,
    lockCodeManagerEntities: LockCodeManagerEntityEntry[],
    configEntryData: LockCodeManagerConfigEntryData
): SlotMapping {
    console.log(`Processing slot ${slotNum}:`, { lockCodeManagerEntities });
    
    const mainEntities: LockCodeManagerEntityEntry[] = [];
    const conditionEntities: LockCodeManagerEntityEntry[] = [];
    const codeSensorEntities: LockCodeManagerEntityEntry[] = [];
    const inSyncEntities: LockCodeManagerEntityEntry[] = [];
    let codeEventEntity: LockCodeManagerEntityEntry | undefined;
    
    const slotEntities = lockCodeManagerEntities.filter((entity) => entity.slotNum === slotNum);
    console.log(`Slot ${slotNum} entities:`, slotEntities);
    
    slotEntities.forEach((entity) => {
        if (entity.key === CODE_SENSOR_KEY) {
            codeSensorEntities.push(entity);
        } else if (entity.key === IN_SYNC_KEY) {
            inSyncEntities.push(entity);
        } else if (entity.key === CODE_EVENT_KEY) {
            codeEventEntity = entity;
        } else if (CONDITION_KEYS.includes(entity.key)) {
            conditionEntities.push(entity);
        } else if (![ACTIVE_KEY, IN_SYNC_KEY].includes(entity.key)) {
            mainEntities.push(entity);
        }
    });
    
    const pinActiveEntity = lockCodeManagerEntities.find(
        (entity) => entity.slotNum === slotNum && entity.key === ACTIVE_KEY
    );
    
    const calendarEntityId: string | null | undefined = configEntryData.slots[slotNum];
    
    console.log(`Slot ${slotNum} mapping:`, { 
        calendarEntityId,
        codeEventEntity,
        codeSensorEntities,
        conditionEntities,
        inSyncEntities,
        mainEntities,
        pinActiveEntity
    });
    
    return {
        calendarEntityId,
        codeEventEntity,
        codeSensorEntities,
        conditionEntities,
        inSyncEntities,
        mainEntities,
        pinActiveEntity,
        slotNum
    };
}

function maybeGenerateFoldEntityRowCard(
    configEntry: ConfigEntryJSONFragment,
    entities: LockCodeManagerEntityEntry[],
    label: string,
    useFoldEntityRow: boolean
) {
    if (!entities || entities.length === 0) {
        console.log(`No entities for ${label}`);
        return [];
    }
    
    const entityCards = generateEntityCards(configEntry, entities);
    
    if (!entityCards || entityCards.length === 0) {
        console.log(`No entity cards generated for ${label}`);
        return [];
    }
    
    console.log(`Generated ${entityCards.length} entity cards for ${label}`);
    
    return useFoldEntityRow
        ? [
              DIVIDER_CARD,
              {
                  entities: entityCards,
                  head: {
                      label,
                      type: 'section'
                  },
                  type: 'custom:fold-entity-row'
              }
          ]
        : [
              {
                  label,
                  type: 'section'
              },
              ...entityCards
          ];
}

function maybeGenerateFoldEntityRowConditionCard(
    configEntry: ConfigEntryJSONFragment,
    conditionEntities: LockCodeManagerEntityEntry[],
    calendarEntityId: string | null | undefined,
    label: string,
    useFoldEntityRow: boolean
) {
    if ((!conditionEntities || conditionEntities.length === 0) && calendarEntityId == null) {
        console.log(`No condition entities or calendar for ${label}`);
        return [];
    }
    
    const entityCards = generateEntityCards(configEntry, conditionEntities || []);
    
    if (calendarEntityId != null) {
        entityCards.unshift({
            entity: calendarEntityId
        });
        console.log(`Added calendar entity ${calendarEntityId}`);
    }
    
    if (!entityCards || entityCards.length === 0) {
        console.log(`No entity cards generated for conditions ${label}`);
        return [];
    }
    
    console.log(`Generated ${entityCards.length} condition entity cards for ${label}`);

    return useFoldEntityRow
        ? [
              DIVIDER_CARD,
              {
                  entities: entityCards,
                  head: {
                      label,
                      type: 'section'
                  },
                  type: 'custom:fold-entity-row'
              }
          ]
        : [
              {
                  label,
                  type: 'section'
              },
              ...entityCards
          ];
}
