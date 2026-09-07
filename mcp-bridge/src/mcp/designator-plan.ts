/** Reserve requested names before any creation, including later batch items. */
export function reserveDesignators(items: Array<{ designator?: string }>, existing: string[]): Set<string> {
	const reserved = new Set(existing.map(value => value.toUpperCase()));
	for (const item of items) {
		if (item.designator === undefined) continue;
		if (!/^[A-Za-z]+[0-9]+$/.test(item.designator))
			throw new Error('designator 必须为字母前缀和数字，如 C6');
		const key = item.designator.toUpperCase();
		if (reserved.has(key)) throw new Error(`DESIGNATOR_CONFLICT: ${item.designator} 已存在或在批次中重复`);
		reserved.add(key);
	}
	return reserved;
}
