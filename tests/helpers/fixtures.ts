import type { SaveInput } from '../../src/core/Save';

/** A checkpoint with every field populated, so a test can spoil one at a time. */
export function aSave(over: Partial<SaveInput> = {}): SaveInput {
  return {
    seed: 1234,
    depth: 2,
    descent: { progress: 0.5, open: false, flood: 1.25, codeKnown: true },
    time: 321.5,
    survivalTime: 300.25,
    player: { x: 1.5, y: 0.05, z: -2.5, yaw: 1.1, pitch: -0.2 },
    stats: { health: 88, thirst: 61.5, oxygen: 40, dehydration: 0 },
    inventory: {
      items: [{ item: { id: 'wrench', durability: 55, ammo: 0, water: 0 }, col: 0, row: 0 }],
      equipped: 0,
    },
    pickups: {
      consumed: ['c:1:2:3'],
      drops: [{ item: { id: 'bottle', durability: null, ammo: 0, water: 12 }, x: 3, y: 0, z: 4 }],
    },
    friends: [{ voiceId: 'v1', x: 5, y: 0, z: 6 }],
    torchCharge: 73.5,
    torchOn: true,
    receiverOnExit: true,
    vending: [['m1', 1]],
    portalOpen: false,
    escapeFuses: 1,
    ...over,
  };
}
