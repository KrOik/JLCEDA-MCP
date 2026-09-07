import { isPlainObjectRecord, toSafeErrorMessage } from '../utils';
import { readComponentGeometry, type Box } from './layout-safety';
import { classifyRow, planTypeRows, auditRows, type RowPart, type RowPlacement } from './type-rows';
import { readNativeAttributes, positionNativeAttribute } from './native-attributes';
import { reserveDesignators } from './designator-plan';

const STORE = 'jlc_mcp_rows_jobs_v1';
interface Item { key: string; uuid: string; libraryUuid: string; designator: string; name?: string; row: ReturnType<typeof classifyRow>; nets: Record<string, string> }
interface Job {
	jobId: string; input: string; state: 'running' | 'done' | 'failed' | 'uncertain'; phase: string;
	items: Item[]; pages: string[]; originalPage: string; schematic: string; documentUuid: string;
	created: Array<{ key: string; id: string; page: string; probe?: boolean }>;
	componentsPlaced: number; pinsRequested: number; pinsConfirmed: number;
	pending?: string; error?: string; verification?: Record<string, boolean>; startedAt: number;
}
let active: Job | undefined;
let ownershipGuard: () => boolean = () => true;
export function setOwnershipGuard(guard: () => boolean) { ownershipGuard = guard; }
export function getBackgroundState() { load(); const job = active ?? [...jobs.values()].find(j => j.state === 'uncertain'); return job ? { jobId: job.jobId, state: job.state, pending: job.pending } : undefined; }
const jobs = new Map<string, Job>();
const str = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || v.length > 256) throw new Error('INVALID_STRING'); return v.trim(); };
function state(v: any, key: string): any { if (Array.isArray(v)) v = v[0]; return v?.[`getState_${key[0].toUpperCase()}${key.slice(1)}`]?.() ?? v?.[key]; }
function load(): void {
	const stored = eda.sys_Storage.getExtensionUserConfig(STORE);
	if (!stored || typeof stored !== 'object') return;
	for (const [id, raw] of Object.entries(stored)) if (!jobs.has(id)) {
		const job = raw as Job;
		if (job.state === 'running') { job.state = 'uncertain'; job.error = 'RUNTIME_RELOADED: inspect recorded pages; never replay pending writes'; }
		jobs.set(id, job);
	}
}
async function save(job: Job) {
	jobs.set(job.jobId, job);
	if (!await eda.sys_Storage.setExtensionUserConfig(STORE, Object.fromEntries(jobs))) throw new Error('JOURNAL_WRITE_FAILED');
}
function summary(job: Job) { return { ok: job.state !== 'failed' && job.state !== 'uncertain', jobId: job.jobId, state: job.state, phase: job.phase, documentUuid: job.documentUuid, pages: job.pages, layout: { preset: 'type-rows', pageCount: job.pages.length, usableWidth: 1000, usableHeight: 600, automaticContinuationRows: true, automaticPagination: true }, progress: { componentsPlaced: job.componentsPlaced, total: job.items.length, pinsRequested: job.pinsRequested, pinsConfirmed: job.pinsConfirmed }, pending: job.pending, error: job.error, verification: job.verification, created: job.created, nextAction: job.state === 'running' ? 'Poll schematic_place_rows with action=status and the same operationId; do not repeat component_place.' : undefined }; }
export function isRowsIdle() { return !active; }
export function rowsWriteBlocked(): boolean { load(); return !!active || [...jobs.values()].some(j => j.state === 'uncertain'); }

export async function handleTypeRowsTask(payload: unknown) {
	if (!isPlainObjectRecord(payload)) throw new Error('INVALID_ARGUMENT');
	load();
	const id = str(payload.operationId);
	if (!/^[A-Za-z0-9_.-]{1,80}$/.test(id)) throw new Error('INVALID_OPERATION_ID');
	const action = payload.action ?? 'start';
	const previous = jobs.get(id);
	if (action === 'status') return previous ? summary(previous) : { ok: false, error: 'JOB_NOT_FOUND' };
	if (action !== 'start') throw new Error('Use start/status; uncertain operations require readback, not automatic replay');
	if (!Array.isArray(payload.components) || !payload.components.length || payload.components.length > 200) throw new Error('components must contain 1..200 items');
	const items: Item[] = payload.components.map(raw => {
		if (!isPlainObjectRecord(raw)) throw new Error('INVALID_COMPONENT');
		const designator = str(raw.designator);
		if (raw.nets !== undefined && !isPlainObjectRecord(raw.nets)) throw new Error('INVALID_NETS');
		const nets = Object.fromEntries(Object.entries(raw.nets ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([pin, net]) => [str(pin), str(net)]));
		const uuid = str(raw.uuid), libraryUuid = str(raw.libraryUuid);
		if (!/^[a-f0-9]{32}$/i.test(uuid) || !/^[a-f0-9]{32}$/i.test(libraryUuid)) throw new Error('LIBRARY_DEVICE_REQUIRED: use component_select candidateRef, not a page-local component UUID');
		return { key: str(raw.key), uuid, libraryUuid, designator, ...(raw.name === undefined ? {} : { name: str(raw.name) }), row: classifyRow(designator, String(raw.name ?? ''), raw.row), nets };
	});
	if (new Set(items.map(i => i.key)).size !== items.length) throw new Error('DUPLICATE_KEY');
	reserveDesignators(items, []);
	const input = JSON.stringify(items);
	if (previous) { if (previous.input !== input) throw new Error('OPERATION_ID_CONFLICT'); return summary(previous); }
	if (rowsWriteBlocked()) return { ok: false, error: 'ROWS_JOB_OWNS_WRITES', jobId: active?.jobId };
	const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	const schematic = await eda.dmt_Schematic.getCurrentSchematicInfo();
	if (!page || !schematic) throw new Error('OPEN_SCHEMATIC_FIRST');
	const job: Job = { jobId: id, input, state: 'running', phase: 'validate', items, pages: [], originalPage: page.uuid, schematic: schematic.uuid, documentUuid: page.uuid, created: [], componentsPlaced: 0, pinsRequested: items.reduce((n, i) => n + Object.keys(i.nets).length, 0), pinsConfirmed: 0, startedAt: Date.now() };
	active = job;
	try { await save(job); } catch (error) { active = undefined; jobs.delete(id); throw error; }
	void execute(job, ownershipGuard).catch(async error => {
		job.state = job.pending ? 'uncertain' : 'failed'; job.error = toSafeErrorMessage(error);
		try { await save(job); } catch { /* Existing write-ahead journal remains authoritative. */ } finally { active = undefined; }
	});
	return summary(job);
}

async function execute(job: Job, ownsLease: () => boolean) {
	const check = async () => {
		if (active !== job) throw new Error('JOB_OWNERSHIP_LOST');
		if (!ownsLease()) throw new Error('BRIDGE_LEASE_LOST');
		if (Date.now() - job.startedAt > 15 * 60 * 1000) throw new Error('JOB_DEADLINE');
		if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== job.documentUuid) throw new Error('DOCUMENT_CHANGED');
	};
	const write = async <T>(intent: string, fn: () => T): Promise<Awaited<T>> => {
		await check(); job.pending = intent; await save(job);
		const result = await fn();
		// Persist returned primitive IDs before clearing the write-ahead barrier.
		const id = state(result, 'primitiveId');
		if (typeof id === 'string' && !job.created.some(c => c.id === id)) job.created.push({ key: intent, id, page: job.documentUuid });
		job.pending = undefined; await save(job); return result;
	};
	const activate = async (uuid: string) => {
		// Only explicit pages belonging to this job may be activated automatically.
		if (!job.pages.includes(uuid)) throw new Error('UNOWNED_PAGE');
		const tab = await eda.dmt_EditorControl.openDocument(uuid);
		if (!tab || !await eda.dmt_EditorControl.activateDocument(tab)) throw new Error('ACTIVATION_FAILED');
		for (let i = 0; i < 40; i++) {
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid === uuid) { job.documentUuid = uuid; await save(job); return; }
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		throw new Error('ACTIVATION_UNCONFIRMED');
	};
	const newPage = async () => {
		await check(); job.pending = 'create-page'; await save(job);
		const uuid = await eda.dmt_Schematic.createSchematicPage(job.schematic);
		if (!uuid) throw new Error('PAGE_CREATE_UNCONFIRMED');
		job.pages.push(uuid); job.pending = undefined; await save(job);
		await activate(uuid);
		await write('name-page', () => eda.dmt_Schematic.modifySchematicPageName(uuid, `ROWS_${job.jobId}_${job.pages.length}`));
		return uuid;
	};
	// Cross-page duplicate designators overwrite netlist entries: reject before creating pages.
	const before = await eda.sch_ManufactureData.getNetlistFile();
	if (!before) throw new Error('NETLIST_UNAVAILABLE');
	const beforeData = JSON.parse(await before.text());
	reserveDesignators(job.items, Object.values(beforeData.components ?? {}).map((c: any) => String(c.props?.Designator ?? '')));
	await newPage();
	job.phase = 'create-measure'; await save(job);
	const parts: RowPart[] = [], ids = new Map<string, string>(), rotations = new Map<string, number>();
	const create = async (item: Item, x: number, y: number, rotation = 0) => {
		const obj = await write(`create:${item.key}`, () => eda.sch_PrimitiveComponent.create({ uuid: item.uuid, libraryUuid: item.libraryUuid }, x, y, undefined, rotation, false, true, true));
		const id = state(obj, 'primitiveId');
		if (!id) { job.pending = `create:${item.key}:missing-id`; throw new Error('CREATE_UNCONFIRMED'); }
		const name = item.name ?? state(obj, 'manufacturerId');
		await write(`identify:${item.key}`, () => eda.sch_PrimitiveComponent.modify(id, { designator: item.designator, uniqueId: id, ...(name ? { name } : {}) }));
		if (state(await eda.sch_PrimitiveComponent.get(id), 'designator') !== item.designator) throw new Error('DESIGNATOR_UNCONFIRMED');
		return id as string;
	};
	const measure = async (item: Item, id: string): Promise<RowPart> => {
		const obj = await eda.sch_PrimitiveComponent.get(id);
		const geometry = await readComponentGeometry(obj, id);
		if (!geometry.measured) throw new Error('GEOMETRY_UNAVAILABLE');
		const x = state(obj, 'x'), y = state(obj, 'y');
		const convert = (b: Box): Box => ({ minX: b.minX - x, maxX: b.maxX - x, minY: y - b.maxY, maxY: y - b.minY });
		for (const number of Object.keys(item.nets)) if (geometry.ports.filter(p => p.pinNumber === number).length !== 1) throw new Error(`INVALID_PIN: ${item.key}.${number}`);
		return { id: item.key, ref: item.designator, row: item.row, body: convert(geometry.body), pins: geometry.ports.map(p => ({ number: p.pinNumber, angle: p.rotation, x: p.x - x, y: y - p.y, net: item.nets[p.pinNumber] ?? '' })), attributes: (await readNativeAttributes(job.documentUuid, id)).map(a => ({ id: a.id, box: convert(a.box) })) };
	};
	for (const item of job.items) {
		const id = await create(item, 600, 400); ids.set(item.key, id);
		let part = await measure(item, id);
		if (['resistor', 'capacitor', 'crystal'].includes(item.row) && part.pins.length === 2 && part.pins.every(p => p.angle === 90 || p.angle === 270) && part.pins[0].angle !== part.pins[1].angle) {
			await write(`rotate:${item.key}`, () => eda.sch_PrimitiveComponent.modify(id, { rotation: 90 }));
			rotations.set(item.key, 90); part = await measure(item, id);
		}
		parts.push(part);
	}
	job.phase = 'plan'; await save(job);
	const plan = planTypeRows(parts);
	const conflicts = auditRows(plan);
	if (conflicts.length) throw new Error(`LAYOUT_MODEL_CONFLICT: ${conflicts.join(',')}`);
	// Remove only measured probes destined for another page, before creating final instances.
	for (const cell of plan.filter(c => c.page > 0)) {
		const id = ids.get(cell.id)!;
		if (!await write(`delete-probe:${cell.id}`, () => eda.sch_PrimitiveComponent.delete(id))) throw new Error('PROBE_DELETE_UNCONFIRMED');
		// get(deletedId) throws in Pro instead of returning undefined. Enumerate to verify absence.
		if ((await eda.sch_PrimitiveComponent.getAll('part' as never, false)).some(p => state(p, 'primitiveId') === id)) throw new Error('PROBE_DELETE_UNCONFIRMED');
		job.created.find(c => c.id === id)!.probe = true;
	}
	const world = (b: Box): Box => ({ minX: b.minX + 60, maxX: b.maxX + 60, minY: 740 - b.maxY, maxY: 740 - b.minY });
	for (const pageIndex of [...new Set(plan.map(c => c.page))]) {
		if (pageIndex > 0) await newPage();
		const local = plan.filter(c => c.page === pageIndex);
		job.phase = 'place'; await save(job);
		for (const cell of local) {
			const item = job.items.find(i => i.key === cell.id)!;
			let id = ids.get(cell.id)!;
			if (pageIndex > 0) { id = await create(item, cell.x + 60, 740 - cell.y, rotations.get(cell.id)); ids.set(cell.id, id); }
			else await write(`place:${item.key}`, () => eda.sch_PrimitiveComponent.modify(id, { x: cell.x + 60, y: 740 - cell.y }));
			const obj = await eda.sch_PrimitiveComponent.get(id);
			if (state(obj, 'x') !== cell.x + 60 || state(obj, 'y') !== 740 - cell.y) throw new Error('PLACEMENT_UNCONFIRMED');
			const attrs = await readNativeAttributes(job.documentUuid, id);
			// Recreated instances have new attribute IDs; match stable native source order.
			const targets = [...cell.attributes].reverse();
			if (attrs.length !== targets.length) throw new Error('ATTRIBUTE_COUNT_CHANGED');
			for (const [i, a] of attrs.entries()) await write(`header:${a.id}`, () => positionNativeAttribute(a.id, world(targets[i].box), check));
			job.componentsPlaced++; await save(job);
		}
		job.phase = 'wire'; await save(job);
		for (const cell of local) for (const route of cell.routes) {
			const wire = await write(`wire:${cell.id}.${route.pin}`, () => eda.sch_PrimitiveWire.create(route.line.flatMap(p => [p.x + 60, 740 - p.y]), route.net));
			if (!state(wire, 'primitiveId')) { job.pending = `wire:${cell.id}.${route.pin}:missing-id`; throw new Error('WIRE_UNCONFIRMED'); }
		}
		// SDK merges segments and regenerates NET attributes; reposition AFTER all wiring.
		await positionNets(local);
	}
	job.phase = 'verify'; await save(job);
	const drc = await eda.sch_Drc.check(true, false, false);
	const file = await eda.sch_ManufactureData.getNetlistFile();
	if (!file) throw new Error('NETLIST_UNAVAILABLE');
	const data = JSON.parse(await file.text());
	for (const item of job.items) for (const [pin, net] of Object.entries(item.nets)) {
		if (data.components?.[ids.get(item.key)!]?.pinInfoMap?.[pin]?.net !== net) throw new Error(`NET_UNCONFIRMED: ${item.key}.${pin}`);
		job.pinsConfirmed++;
	}
	// DRC/netlist generation may regenerate labels: final per-page readback and correction.
	for (const [index, page] of job.pages.entries()) { await activate(page); await positionNets(plan.filter(c => c.page === index)); }
	job.verification = { placementConfirmed: true, connectionsConfirmed: true, geometryModelPassed: true, textGeometryVerified: true, nativeRenderVerified: false, drcCheckPassed: drc === true };
	job.state = 'done'; job.phase = 'done'; await save(job); active = undefined;
	async function positionNets(local: RowPlacement[]) {
		const attributes = await readNativeAttributes(job.documentUuid);
		const labels = attributes.filter(a => a.key === 'NET');
		for (const cell of local) for (const route of cell.routes) {
			// A single physical wire per pin is expected; same-name nets elsewhere are separate.
			const matches = labels.filter(a => a.native.getState_Value() === route.net && a.box.minX >= world(cell.envelope).minX - 500 && a.box.maxX <= world(cell.envelope).maxX + 500);
			const pin = route.line[0];
			const candidate: typeof matches = [];
			for (const a of matches) {
				const w = await eda.sch_PrimitiveWire.get(a.parent);
				const line = state(w, 'line');
				if (Array.isArray(line) && line.flat().some((n: number, i: number, all: number[]) => i % 2 === 0 && n === pin.x + 60 && all[i + 1] === 740 - pin.y)) candidate.push(a);
			}
			if (candidate.length !== 1) throw new Error(`NET_LABEL_UNAVAILABLE: ${cell.id}.${route.pin}`);
			const horizontal = route.line.at(-1)!.y === route.line.at(-2)!.y;
			await write(`net-label:${candidate[0].id}`, () => positionNativeAttribute(candidate[0].id, world(route.label), check, 10, horizontal ? 0 : 90));
		}
	}
}
