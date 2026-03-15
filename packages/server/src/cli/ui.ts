import pc from "picocolors";

// ── Banner ──────────────────────────────────────────────────────────────────

export function printBanner(): void {
	console.log();
	console.log(pc.bold(pc.cyan("  VybeVoice")) + pc.dim(" — Voice Orchestrator"));
	console.log();
}

// ── Status messages ─────────────────────────────────────────────────────────

export function success(msg: string): void {
	console.log(`  ${pc.green("✓")} ${msg}`);
}

export function error(msg: string): void {
	console.log(`  ${pc.red("✗")} ${msg}`);
}

export function warn(msg: string): void {
	console.log(`  ${pc.yellow("!")} ${msg}`);
}

export function info(msg: string): void {
	console.log(`  ${pc.blue("·")} ${msg}`);
}

// ── Summary box ─────────────────────────────────────────────────────────────

export function printSummary(title: string, rows: Array<[string, string]>): void {
	const labelWidth = Math.max(...rows.map(([label]) => label.length));

	console.log();
	console.log(`  ${pc.bold(title)}`);
	console.log(`  ${"─".repeat(labelWidth + 12)}`);
	for (const [label, value] of rows) {
		console.log(`  ${pc.dim(label.padEnd(labelWidth))}  ${value}`);
	}
	console.log();
}

// ── Hints ───────────────────────────────────────────────────────────────────

export function hint(msg: string): void {
	console.log(pc.dim(`  ${msg}`));
}
