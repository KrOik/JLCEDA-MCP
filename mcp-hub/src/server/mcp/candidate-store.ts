import { randomBytes } from 'node:crypto';
import { isPlainObjectRecord } from '../../utils';

export class CandidateStore {
  private items = new Map<string, { uuid: string; libraryUuid: string; name?: string; expires: number }>();
  private ids = new Map<string, string>();
  register(candidate: Record<string, unknown>): string | undefined {
    if (typeof candidate.uuid !== 'string' || !candidate.uuid || typeof candidate.libraryUuid !== 'string' || !candidate.libraryUuid) return undefined;
    for (const [ref, item] of this.items) if (item.expires <= Date.now()) { this.items.delete(ref); this.ids.delete(JSON.stringify([item.libraryUuid, item.uuid])); }
    const key = JSON.stringify([candidate.libraryUuid, candidate.uuid]);
    const found = this.ids.get(key);
    if (found) return found;
    if (this.items.size >= 512) {
      const ref = this.items.keys().next().value!; const item = this.items.get(ref)!;
      this.items.delete(ref); this.ids.delete(JSON.stringify([item.libraryUuid, item.uuid]));
    }
    const ref = `c_${randomBytes(5).toString('hex')}`;
    this.items.set(ref, { uuid: candidate.uuid, libraryUuid: candidate.libraryUuid, name: typeof candidate.name === 'string' ? candidate.name : undefined, expires: Date.now() + 1800000 }); this.ids.set(key, ref);
    return ref;
  }
  expand(components: unknown, includeName = false): unknown {
    if (!Array.isArray(components)) return components;
    return components.map(component => {
      if (!isPlainObjectRecord(component) || component.candidateRef === undefined) return component;
      const item = this.items.get(String(component.candidateRef));
      if (!item || item.expires <= Date.now()) throw new Error('CANDIDATE_EXPIRED: 重新选型获取引用，或传入真实 uuid/libraryUuid');
      if ((component.uuid !== undefined && component.uuid !== item.uuid) || (component.libraryUuid !== undefined && component.libraryUuid !== item.libraryUuid)) throw new Error('CANDIDATE_MISMATCH');
      const { candidateRef: _ref, ...rest } = component;
      return { ...(includeName && item.name ? { name: item.name } : {}), ...rest, uuid: item.uuid, libraryUuid: item.libraryUuid };
    });
  }
  present(value: unknown): unknown {
    if (!isPlainObjectRecord(value) || !Array.isArray(value.candidates)) return value;
    return { ...value, candidates: value.candidates.map(raw => {
      const candidate = raw as Record<string, unknown>;
      const candidateRef = this.register(candidate);
      const selected = Object.fromEntries(['name', 'footprintName', 'manufacturer', 'manufacturerId', 'supplierId', 'exactMatch', 'lcscInventory', 'lcscPrice'].filter(k => candidate[k] !== undefined && candidate[k] !== '').map(k => [k, candidate[k]]));
      return { ...(candidateRef ? { candidateRef } : { uuid: candidate.uuid, libraryUuid: candidate.libraryUuid }), ...selected, ...(candidate.description ? { description: String(candidate.description).slice(0, 160), ...(String(candidate.description).length > 160 ? { descriptionTruncated: true } : {}) } : {}) };
    }) };
  }
}
