import { expect, it } from 'vitest';
import { parseNativeWireObstacles } from './schematic-wire-reader';
const source = [
	'{"type":"DOCHEAD"}||{"uuid":"p"}|',
	'{"type":"WIRE","id":"w"}||{}|',
	'{"type":"LINE"}||{"lineGroup":"w","startX":495,"startY":-515,"endX":515,"endY":-515}|',
	'{"type":"LINE"}||{"lineGroup":"w","startX":495,"startY":-535,"endX":495,"endY":-515}|',
	'{"type":"LINE"}||{"lineGroup":"w","startX":335,"startY":-535,"endX":495,"endY":-535}|',
].join('\n');
it('reads three actual segments without phantom diagonal connections between them', () => {
	const obstacles = parseNativeWireObstacles(source, 'p');
	expect(obstacles.map(o => o.segment)).toEqual([[495, 515, 515, 515], [495, 535, 495, 515], [335, 535, 495, 535]]);
	expect(obstacles.every(o => o.segment[0] === o.segment[2] || o.segment[1] === o.segment[3])).toBe(true);
});
it('rejects a wrong document and missing wire segments', () => {
	expect(() => parseNativeWireObstacles(source, 'other')).toThrow('DOCUMENT_CHANGED');
	expect(() => parseNativeWireObstacles(source.split('\n').slice(0, 2).join('\n'), 'p')).toThrow('WIRE_SEGMENTS_UNAVAILABLE');
});
