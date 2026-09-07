/** A deadline cannot cancel an EDA API call; it only forbids further mutations. */
let deadlineAt: number | undefined;

export function setExecutionDeadline(value: number | undefined): void {
	deadlineAt = value;
}

export function assertExecutionDeadline(): void {
	if (deadlineAt && Date.now() >= deadlineAt)
		throw new Error('TASK_EXPIRED: 不再执行后续写操作；请回读确认此前结果');
}
