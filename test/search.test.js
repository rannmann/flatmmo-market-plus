import { describe, it, expect } from 'vitest';
import { scoreItem, searchItems, isSubsequence } from '../src/search.js';

const items = [
  { name: 'unpowered_orb', displayName: 'Unpowered Orb' },
  { name: 'air_orb', displayName: 'Air Orb' },
  { name: 'stardust', displayName: 'Stardust' },
  { name: 'raw_shark', displayName: 'Raw Shark' },
  { name: 'ancient_scimitar', displayName: 'Ancient Scimitar' },
];

const find = (q, opts) => searchItems(q, items, opts).map((r) => r.item.name);

describe('searchItems', () => {
  it('finds an item by its display name, not just the snake_case one', () => {
    expect(find('Unpowered Orb')[0]).toBe('unpowered_orb');
  });

  it('still matches the raw snake_case name', () => {
    expect(find('unpowered_orb')[0]).toBe('unpowered_orb');
  });

  it('matches a word in the middle, which a datalist cannot do', () => {
    expect(find('orb')).toContain('unpowered_orb');
    expect(find('orb')).toContain('air_orb');
  });

  it('matches initials', () => {
    expect(find('as')[0]).toBe('ancient_scimitar');
  });

  it('prefers the shorter name on an equal-quality match', () => {
    // Both start the word "Orb"; Air Orb is shorter so it leads.
    expect(find('orb')[0]).toBe('air_orb');
  });

  it('ranks an exact match above a mere prefix', () => {
    expect(scoreItem('air orb', { name: 'air_orb', displayName: 'Air Orb' })).toBeGreaterThan(
      scoreItem('air', { name: 'air_orb', displayName: 'Air Orb' })
    );
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(find('zzzzqq')).toEqual([]);
  });

  it('lists the pool unfiltered for an empty query', () => {
    expect(find('')).toHaveLength(items.length);
    expect(find('   ')).toHaveLength(items.length);
  });

  it('honours the limit', () => {
    expect(find('', { limit: 2 })).toHaveLength(2);
  });

  it('never offers an item the game would reject', () => {
    const allowed = new Set(['air_orb']);
    expect(find('orb', { allowed })).toEqual(['air_orb']);
  });

  it('survives a missing item list', () => {
    expect(searchItems('orb', null)).toEqual([]);
  });
});

describe('isSubsequence', () => {
  it('matches characters in order with gaps', () => {
    expect(isSubsequence('uporb', 'unpowered orb')).toBe(true);
  });

  it('rejects out-of-order characters', () => {
    expect(isSubsequence('brou', 'unpowered orb')).toBe(false);
  });
});
