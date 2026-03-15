import type { SpecialistRunner } from "@voice-orchestrator/core";
import { MerlinSpecialist } from "../../specialists/merlin.js";
import type { BackendOptions, OpenClawOptions } from "../config.js";

export function createOpenClawSpecialist(options: BackendOptions): SpecialistRunner {
	const opts = options as OpenClawOptions;
	return new MerlinSpecialist({
		url: opts.url,
		token: opts.token,
		agentId: opts.agentId,
	});
}
