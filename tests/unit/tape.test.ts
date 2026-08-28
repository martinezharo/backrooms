// The timecode in the corner of the landing, pause, death and escape screens.
// It is cosmetic, but it is on every screen a player sees before and after the
// game, and it is fed raw survival seconds straight out of the run.

import { beforeEach, describe, expect, it } from 'vitest';
import { stampTape, timecode } from '../../src/ui/tape';

describe('timecode', () => {
  it.each([
    [0, 0, '00:00:00:00'],
    [1, 0, '00:00:01:00'],
    [59, 24, '00:00:59:24'],
    [60, 0, '00:01:00:00'],
    [3599, 0, '00:59:59:00'],
    [3600, 0, '01:00:00:00'],
    [3661, 12, '01:01:01:12'],
  ])('renders %ds +%df as %s', (seconds, frames, expected) => {
    expect(timecode(seconds, frames)).toBe(expected);
  });

  it('always fills every field to two digits', () => {
    for (const s of [0, 7, 61, 3601, 86399]) expect(timecode(s)).toMatch(/^\d\d:\d\d:\d\d:\d\d$/);
  });

  it('truncates rather than rounding, the way a deck does', () => {
    expect(timecode(59.9)).toBe('00:00:59:00');
  });

  it('wraps the frame counter at 25', () => {
    expect(timecode(0, 25)).toBe('00:00:00:00');
    expect(timecode(0, 26)).toBe('00:00:00:01');
  });

  it('clamps a negative clock to zero instead of printing a minus', () => {
    expect(timecode(-5)).toBe('00:00:00:00');
  });

  it('does not fall over past a day', () => {
    expect(timecode(90000)).toBe('25:00:00:00');
  });
});

describe('stampTape', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('writes a frozen readout into the screen it is given', () => {
    document.body.innerHTML = '<div id="s"><span class="tape-time">--</span></div>';
    stampTape(document.getElementById('s')!, 125);
    expect(document.querySelector('.tape-time')!.textContent).toMatch(/^00:02:05:\d\d$/);
  });

  it('shrugs off a screen with no readout on it', () => {
    document.body.innerHTML = '<div id="s"></div>';
    expect(() => stampTape(document.getElementById('s')!, 10)).not.toThrow();
  });
});
