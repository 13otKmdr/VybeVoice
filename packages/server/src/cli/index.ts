import { Command } from "commander";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStartCommand } from "./commands/start.js";

export function createProgram(): Command {
	const program = new Command("vybevoice")
		.description("VybeVoice — Voice orchestrator with pluggable agent backends")
		.version("0.1.0");

	registerInitCommand(program);
	registerStartCommand(program);
	registerConfigureCommand(program);

	return program;
}
