class MicCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = new Float32Array(0);
		this.chunkSize = 2048;
	}

	process(inputs) {
		const input = inputs[0];
		const channel = input?.[0];
		if (!channel?.length) {
			return true;
		}

		const merged = new Float32Array(this.buffer.length + channel.length);
		merged.set(this.buffer, 0);
		merged.set(channel, this.buffer.length);

		let offset = 0;
		while (merged.length - offset >= this.chunkSize) {
			this.port.postMessage(merged.slice(offset, offset + this.chunkSize));
			offset += this.chunkSize;
		}

		this.buffer = merged.slice(offset);
		return true;
	}
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
