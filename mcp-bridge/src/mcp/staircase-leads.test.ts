import { expect, it } from 'vitest';
import { staircaseLeads, wiresTouch } from './net-lead';
for (const rotation of [0, 90, 180, 270]) it(`routes dense and sparse pins without crossings at ${rotation}`, () => {
	for (const coordinates of [[0, 10, 20, 30, 40], [0, 10, 100, 110, 120], [0], [0, 10]]) {
		const pins = coordinates.map(n => ({ x: rotation % 180 ? n : 0, y: rotation % 180 ? 0 : n, rotation }));
		const lines = staircaseLeads(pins);
		expect(staircaseLeads(pins)).toEqual(lines);
		lines.forEach((line, i) => {
			expect(line.slice(0, 2)).toEqual([pins[i].x, pins[i].y]);
			for (let j = i + 1; j < lines.length; j++) expect(wiresTouch(line, lines[j])).toBe(false);
		});
	}
});
it('rejects invalid spacing and diagonal pin directions', () => {
	expect(() => staircaseLeads([], 80, 15)).toThrow();
	expect(() => staircaseLeads([{ x: 0, y: 0, rotation: 45 }])).toThrow();
});
