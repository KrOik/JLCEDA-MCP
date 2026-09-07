export interface TaskModule {
	abi: number;
	isIdle: () => boolean;
	handlers: Record<string, (payload: unknown) => Promise<unknown>>;
	setExecutionDeadline: (deadline?: number) => void;
	setOwnershipGuard?: (guard: () => boolean) => void;
	getBackgroundState?: () => { jobId: string; state: string; pending?: string } | undefined;
}

/** Only task code is replaceable: sockets, leases and timers retain their owner. */
export class HotUpdateManager {
	current: TaskModule;
	status = { state: 'bundled', revision: 'bundled', error: '' };
	private timer?: ReturnType<typeof setInterval>;
	private checking = false;
	private generation = 0;
	private previous?: { module: TaskModule; revision: string };
	private rejected = new Set<string>();
	constructor(bundled: TaskModule, private busy: () => boolean) {
		this.current = bundled;
	}

	start(): void {
		if (this.timer) return;
		this.generation++;
		this.timer = setInterval(() => { void this.check(); }, 15000);
		void this.check();
	}

	stop(): void {
		this.generation++;
		clearInterval(this.timer);
		this.timer = undefined;
	}

	rollback(): boolean {
		if (this.checking || this.busy() || !this.current.isIdle() || !this.previous) return false;
		this.rejected.add(this.status.revision);
		this.current = this.previous.module;
		this.status = { state: 'rolled-back', revision: this.previous.revision, error: '' };
		this.previous = undefined;
		return true;
	}

	async check(): Promise<void> {
		if (this.checking || this.busy()) return;
		this.checking = true;
		const generation = this.generation;
		let revision = '';
		try {
			if (!this.current.isIdle()) return;
			// Deliberately local-only. Remote websocket settings never become code URLs.
			const configured = eda.sys_Storage.getExtensionUserConfig('jlc_mcp_ota_url');
			const base = new URL(typeof configured === 'string' ? configured : 'http://127.0.0.1:7655');
			if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash)
				throw new Error('OTA requires a loopback HTTP origin');
			const get = async (path: string): Promise<Response> => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					return await Promise.race([
						eda.sys_ClientUrl.request(`${base.origin}${path}`, 'GET'),
						new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('OTA request timeout')), 5000); }),
					]);
				} finally { clearTimeout(timer); }
			};
			const response = await get('/ota/manifest');
			if (response.status === 404) return;
			if (!response.ok) throw new Error(`OTA manifest HTTP ${response.status}`);
			const manifest = await response.json();
			revision = manifest.sha256;
			if (manifest.abi !== 1 || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || !Number.isInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 8000000)
				throw new Error('Invalid OTA manifest / incompatible ABI');
			if (revision === this.status.revision) {
				if (this.status.state === 'failed') this.status = { state: 'confirmed', revision, error: '' };
				return;
			}
			if (this.rejected.has(revision)) return;
			const codeResponse = await get(`/ota/bundles/${revision}.js`);
			if (!codeResponse.ok) throw new Error(`OTA bundle HTTP ${codeResponse.status}`);
			const code = await codeResponse.text();
			const bytes = new TextEncoder().encode(code);
			if (bytes.byteLength !== manifest.bytes) throw new Error('OTA size mismatch');
			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
			if (hash !== revision) throw new Error('OTA checksum mismatch');
			if (generation !== this.generation || this.busy() || !this.current.isIdle()) return;
			// Evaluation is synchronous and task modules must have no activation side effects.
			const candidate = new Function('eda', `${code}\nreturn jlcTaskModule;`)(eda) as TaskModule;
			if (candidate?.abi !== 1 || typeof candidate.setExecutionDeadline !== 'function' || typeof candidate.isIdle !== 'function' || !candidate.handlers
				|| Object.keys(this.current.handlers).some(key => typeof candidate.handlers[key] !== 'function'))
				throw new Error('OTA task-module contract mismatch');
			if (candidate.isIdle() !== true) throw new Error('OTA candidate is not idle');
			this.previous = { module: this.current, revision: this.status.revision };
			this.current = candidate;
			this.status = { state: 'confirmed', revision, error: '' };
		} catch (error) {
			if (generation === this.generation) this.status = { ...this.status, state: 'failed', error: String(error) };
		} finally { this.checking = false; }
	}
}
