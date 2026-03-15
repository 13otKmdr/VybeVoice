const SAMPLE_RATE = 24_000;
const MIC_WORKLET_PATH = "/mic-worklet.js";

const state = {
	sessionId: null,
	provider: "openai",
	socket: null,
	audioContext: null,
	mediaStream: null,
	micSource: null,
	micNode: null,
	silentGain: null,
	analyser: null,
	playbackCursor: 0,
	activeSources: new Set(),
	messages: [],
	tasks: new Map(),
	assistantDraftId: null,
	recentMessages: new Map(),
	animationFrameId: null,
};

const elements = {
	capabilityCopy: document.querySelector("#capability-copy"),
	chatHistory: document.querySelector("#chat-history"),
	instructions: document.querySelector("#instructions"),
	interruptResponse: document.querySelector("#interrupt-response"),
	model: document.querySelector("#model"),
	provider: document.querySelector("#provider"),
	sendText: document.querySelector("#send-text"),
	sendIcon: document.querySelector("#send-text svg"),
	sessionMeta: document.querySelector("#session-meta"),
	settingsBtn: document.querySelector("#settings-btn"),
	settingsCloseBtn: document.querySelector("#settings-close-btn"),
	settingsOverlay: document.querySelector("#settings-overlay"),
	startSession: document.querySelector("#start-session"),
	statusCopy: document.querySelector("#status-copy"),
	statusPill: document.querySelector("#status-pill"),
	stopSession: document.querySelector("#stop-session"),
	textMessage: document.querySelector("#text-message"),
	transcript: document.querySelector("#transcript"),
	userId: document.querySelector("#user-id"),
	voice: document.querySelector("#voice"),
	sidebar: document.querySelector("#sidebar"),
	sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
	sidebarToggle: document.querySelector("#sidebar-toggle"),
	sidebarOpenBtn: document.querySelector("#sidebar-open-btn"),
	sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
	newChatBtn: document.querySelector("#new-chat-btn"),
	composer: document.querySelector("#composer"),
	slideIndicator: document.querySelector("#slide-indicator"),
	equalizerBars: null, // Will be created dynamically
};

elements.userId.value = `browser-${Math.random().toString(36).slice(2, 8)}`;

// ── Equalizer setup for voice mode ───────────────────────────────────────

function createEqualizer() {
	const equalizer = document.createElement("div");
	equalizer.className = "equalizer";
	
	for (let i = 0; i < 4; i++) {
		const bar = document.createElement("div");
		bar.className = "eq-bar";
		bar.style.height = "4px";
		equalizer.appendChild(bar);
	}
	
	elements.sendText.appendChild(equalizer);
	elements.equalizerBars = equalizer.querySelectorAll(".eq-bar");
}

function startEqualizerAnimation() {
	if (state.animationFrameId) return;
	if (!state.analyser || !elements.equalizerBars) return;
	
	const analyser = state.analyser;
	const dataArray = new Uint8Array(analyser.frequencyBinCount);
	
	function updateBars() {
		if (!state.analyser) {
			stopEqualizerAnimation();
			return;
		}
		
		analyser.getByteFrequencyData(dataArray);
		
		// Sample 4 frequency bands across the spectrum
		const bandSize = Math.floor(dataArray.length / 4);
		
		elements.equalizerBars.forEach((bar, i) => {
			// Average the values in this frequency band
			let sum = 0;
			const start = i * bandSize;
			const end = start + bandSize;
			for (let j = start; j < end; j++) {
				sum += dataArray[j];
			}
			const average = sum / bandSize;
			
			// Map 0-255 to 4-20px height
			const height = Math.max(4, (average / 255) * 20);
			bar.style.height = `${height}px`;
		});
		
		state.animationFrameId = requestAnimationFrame(updateBars);
	}
	
	state.animationFrameId = requestAnimationFrame(updateBars);
}

function stopEqualizerAnimation() {
	if (state.animationFrameId) {
		cancelAnimationFrame(state.animationFrameId);
		state.animationFrameId = null;
	}
	
	// Reset bar heights
	if (elements.equalizerBars) {
		elements.equalizerBars.forEach(bar => {
			bar.style.height = "4px";
		});
	}
}

// Create equalizer on load
createEqualizer();

// ── Sidebar toggle ──────────────────────────────────────────────────────

elements.sidebarToggle.addEventListener("click", () => {
	toggleSidebar();
});

elements.sidebarOpenBtn.addEventListener("click", () => {
	toggleSidebar();
});

// Close sidebar when clicking backdrop (mobile)
elements.sidebarBackdrop.addEventListener("click", () => {
	closeSidebar();
});

function toggleSidebar() {
	const sidebar = elements.sidebar;
	const openBtn = elements.sidebarOpenBtn;
	const backdrop = elements.sidebarBackdrop;
	const isCollapsed = sidebar.classList.contains("collapsed");
	
	if (isCollapsed) {
		sidebar.classList.remove("collapsed");
		openBtn.classList.add("hidden");
		backdrop.classList.add("visible");
		backdrop.classList.remove("hidden");
	} else {
		sidebar.classList.add("collapsed");
		openBtn.classList.remove("hidden");
		backdrop.classList.remove("visible");
		backdrop.classList.add("hidden");
	}
	
	localStorage.setItem("sidebar-collapsed", !isCollapsed ? "1" : "0");
}

function closeSidebar() {
	const sidebar = elements.sidebar;
	const openBtn = elements.sidebarOpenBtn;
	const backdrop = elements.sidebarBackdrop;
	
	sidebar.classList.add("collapsed");
	openBtn.classList.remove("hidden");
	backdrop.classList.remove("visible");
	backdrop.classList.add("hidden");
	localStorage.setItem("sidebar-collapsed", "1");
}

// Restore sidebar collapse state
if (localStorage.getItem("sidebar-collapsed") === "1") {
	elements.sidebar.classList.add("collapsed");
	elements.sidebarOpenBtn.classList.remove("hidden");
}

// ── Settings modal ──────────────────────────────────────────────────────

elements.settingsBtn.addEventListener("click", () => {
	elements.settingsOverlay.classList.remove("hidden");
});

elements.settingsCloseBtn.addEventListener("click", () => {
	elements.settingsOverlay.classList.add("hidden");
});

elements.settingsOverlay.addEventListener("click", (event) => {
	if (event.target === elements.settingsOverlay) {
		elements.settingsOverlay.classList.add("hidden");
	}
});
// ── New chat button ─────────────────────────────────────────────────────

elements.newChatBtn.addEventListener("click", () => {
	if (state.sessionId) {
		void stopSession();
	}
});

// ── Chat history ────────────────────────────────────────────────────────

async function fetchAndRenderHistory() {
	try {
		const response = await fetch("/sessions");
		if (!response.ok) return;
		const data = await response.json();
		renderHistory(data.sessions || []);
	} catch {
		// silently fail
	}
}

function renderHistory(sessions) {
	const container = elements.chatHistory;
	container.innerHTML = "";

	if (sessions.length === 0) {
		const empty = document.createElement("p");
		empty.className = "history-empty";
		empty.textContent = "No sessions yet";
		container.append(empty);
		return;
	}

	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const todaySessions = [];
	const olderSessions = [];

	for (const session of sessions) {
		if (session.lastActiveAt >= todayStart) {
			todaySessions.push(session);
		} else {
			olderSessions.push(session);
		}
	}

	if (todaySessions.length > 0) {
		const label = document.createElement("p");
		label.className = "history-label";
		label.textContent = "Today";
		container.append(label);
		for (const session of todaySessions) {
			container.append(createHistoryItem(session));
		}
	}

	if (olderSessions.length > 0) {
		const label = document.createElement("p");
		label.className = "history-label";
		label.textContent = "Older";
		container.append(label);
		for (const session of olderSessions) {
			container.append(createHistoryItem(session));
		}
	}
}

function createHistoryItem(session) {
	const btn = document.createElement("button");
	btn.className = "history-item";
	if (session.id === state.sessionId) {
		btn.classList.add("active");
	}

	const dot = document.createElement("span");
	dot.className = "history-dot";
	if (session.state === "active" || session.state === "idle") {
		dot.classList.add("active");
	} else {
		dot.classList.add("ended");
	}

	const title = document.createElement("span");
	title.className = "history-title";
	const sessionDate = new Date(session.startedAt);
	title.textContent = session.metadata?.title || `Session ${sessionDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

	btn.append(dot, title);

	btn.addEventListener("click", () => {
		// For now, just highlight — future: reconnect to session
		const items = elements.chatHistory.querySelectorAll(".history-item");
		for (const item of items) {
			item.classList.remove("active");
		}
		btn.classList.add("active");
	});

	return btn;
}

// Fetch history on load
fetchAndRenderHistory();

// ── Auto-resize textarea ────────────────────────────────────────────────

elements.textMessage.addEventListener("input", () => {
	autoResizeTextarea();
	updateSendButton();
});

function autoResizeTextarea() {
	const textarea = elements.textMessage;
	textarea.style.height = "auto";
	textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
}

function updateSendButton() {
	// Always enabled - slide-to-talk works without text, tap sends only if text exists
	elements.sendText.disabled = false;
}

// ── Provider change ─────────────────────────────────────────────────────

elements.provider.addEventListener("change", () => {
	const provider = elements.provider.value;
	if (!state.sessionId) {
		state.provider = provider;
	}
	elements.model.value = provider === "openai" ? "gpt-realtime" : "MiniMax-M2.5";
	elements.voice.value = provider === "openai" ? "marin" : "English_Graceful_Lady";
	renderCapabilityCopy();
	syncControls();
});

// ── Button events ───────────────────────────────────────────────────────

if (elements.startSession) {
	elements.startSession.addEventListener("click", () => {
		void startSession({ activateVoice: true });
	});
}

elements.stopSession.addEventListener("click", () => {
	void stopSession();
});

elements.interruptResponse.addEventListener("click", () => {
	sendSocketMessage({ type: "response.cancel" });
	clearPlayback();
	setStatus("Stopped the current reply.", "listening");
});

elements.sendText.addEventListener("click", () => {
	// If touch already handled this tap, skip
	if (slideState.tapHandled) {
		slideState.tapHandled = false;
		return;
	}
	void sendTypedMessage();
});

// ── Slide-to-talk gesture ───────────────────────────────────────────────

const SLIDE_THRESHOLD = 80; // pixels to trigger voice mode
const TAP_THRESHOLD = 20;
const slideState = {
	isSliding: false,
	startX: 0,
	startY: 0,
	currentX: 0,
	triggered: false,
	originalTransform: "",
	tapHandled: false, // Prevent click event from double-firing after touch
};

function getSlideMetrics(touch) {
	const deltaX = touch.clientX - slideState.startX;
	const deltaY = touch.clientY - slideState.startY;
	const horizontalGesture = Math.abs(deltaY) <= Math.abs(deltaX) * 1.5;

	return { deltaX, deltaY, horizontalGesture };
}

function markVoiceThresholdReached() {
	if (slideState.triggered) return;

	slideState.triggered = true;
	elements.sendText.classList.add("voice-triggered");

	if (navigator.vibrate) {
		navigator.vibrate(50);
	}
}

function resetSlideGesture() {
	slideState.isSliding = false;
	slideState.triggered = false;

	elements.sendText.classList.remove("sliding", "voice-triggered");
	elements.sendText.style.transform = slideState.originalTransform;
	elements.slideIndicator.classList.remove("visible");
	elements.slideIndicator.style.opacity = "";
}

async function activateVoiceModeFromGesture() {
	const provider = state.sessionId ? state.provider : elements.provider.value;

	// Acquire the mic while the touch gesture is still active so browser voice mode can start reliably.
	if (provider === "openai" && !state.audioContext) {
		try {
			await ensureAudioPipeline();
		} catch (error) {
			console.warn("Microphone unavailable; voice activation may fail.", error);
		}
	}

	await startSession({ activateVoice: true });
}

elements.sendText.addEventListener("touchstart", (event) => {
	if (elements.sendText.disabled) return;
	
	const touch = event.touches[0];
	slideState.isSliding = true;
	slideState.startX = touch.clientX;
	slideState.startY = touch.clientY;
	slideState.currentX = touch.clientX;
	slideState.triggered = false;
	slideState.originalTransform = elements.sendText.style.transform || "";
	slideState.tapHandled = false;
	
	elements.sendText.classList.add("sliding");
	elements.slideIndicator.classList.add("visible");
}, { passive: true });

elements.sendText.addEventListener("touchmove", (event) => {
	if (!slideState.isSliding) return;
	
	const touch = event.touches[0];
	const { deltaX, deltaY, horizontalGesture } = getSlideMetrics(touch);
	
	// If vertical movement is dominant, cancel slide
	if (!horizontalGesture) {
		return;
	}
	
	// Prevent scrolling while sliding horizontally
	if (deltaX > 10) {
		event.preventDefault();
	}
	
	slideState.currentX = touch.clientX;
	
	// Calculate slide progress (clamped 0-1)
	const progress = Math.min(1, Math.max(0, deltaX / SLIDE_THRESHOLD));
	
	// Apply visual feedback
	const translateX = Math.max(0, deltaX * 0.8);
	const scale = 1 + progress * 0.15;
	elements.sendText.style.transform = `translateX(${translateX}px) scale(${scale})`;
	
	// Show slide indicator progress
	elements.slideIndicator.style.opacity = progress;
	
	// Check if threshold reached
	if (deltaX >= SLIDE_THRESHOLD) {
		markVoiceThresholdReached();
	}
}, { passive: false });

elements.sendText.addEventListener("touchend", (event) => {
	if (!slideState.isSliding) return;
	
	const touch = event.changedTouches[0];
	const { deltaX, deltaY, horizontalGesture } = touch
		? getSlideMetrics(touch)
		: { deltaX: slideState.currentX - slideState.startX, deltaY: 0, horizontalGesture: true };
	const crossedThreshold = horizontalGesture && deltaX >= SLIDE_THRESHOLD;
	const isTap = Math.abs(deltaX) < TAP_THRESHOLD && Math.abs(deltaY) < TAP_THRESHOLD;
	
	slideState.tapHandled = crossedThreshold || isTap;

	if (crossedThreshold) {
		markVoiceThresholdReached();
		void activateVoiceModeFromGesture();
	} else if (isTap) {
		// It was a tap, send message if there's text
		void sendTypedMessage();
	}
	
	resetSlideGesture();
});

elements.sendText.addEventListener("touchcancel", () => {
	slideState.tapHandled = false;
	resetSlideGesture();
});

elements.textMessage.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void sendTypedMessage();
	}
});

window.addEventListener("beforeunload", () => {
	if (state.socket?.readyState === WebSocket.OPEN) {
		state.socket.close(1000, "page unload");
	}
});

renderCapabilityCopy();
setStatus("Idle", "idle");
renderThread();
syncControls();
updateSendButton();

// ── Session management ──────────────────────────────────────────────────

async function startSession({ activateVoice = true } = {}) {
	if (state.sessionId) {
		if (activateVoice) {
			await ensureVoiceLive();
		}
		return;
	}

	const userId = elements.userId.value.trim();
	if (!userId) {
		setStatus("User ID is required.", "error");
		return;
	}

	const payload = {
		userId,
		provider: elements.provider.value,
		model: elements.model.value.trim() || undefined,
		voice: elements.voice.value.trim() || undefined,
		instructions: elements.instructions.value.trim() || undefined,
	};

	setStatus("Starting session...", "busy");
	syncControls();

	try {
		const response = await fetch("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		
		let data = {};
		try {
			data = await response.json();
		} catch (e) {
			if (!response.ok) {
				throw new Error("Failed connecting to server.");
			}
		}
		
		if (!response.ok) {
			throw new Error(data.error || "Failed to create session.");
		}

		state.sessionId = data.session.id;
		state.provider = data.provider;
		resetConversationState();
		renderSessionMeta();
		renderCapabilityCopy();
		syncControls();

		await connectSessionSocket();
		fetchAndRenderHistory();

		if (activateVoice) {
			await ensureVoiceLive();
		} else {
			setStatus("Session ready. Type or start voice.", "ready");
		}
	} catch (error) {
		console.error(error);
		const failedSessionId = state.sessionId;
		await teardownSession(false);
		if (failedSessionId) {
			try {
				await fetch(`/sessions/${failedSessionId}`, { method: "DELETE" });
			} catch {}
		}
		setStatus(error instanceof Error ? error.message : String(error), "error");
	}
}

async function ensureVoiceLive() {
	if (!state.sessionId) return;

	if (state.provider !== "openai") {
		setStatus("This provider is text-only in the browser.", "warning");
		return;
	}

	if (state.audioContext) {
		setStatus("Listening. Speak naturally.", "ready");
		return;
	}

	try {
		await ensureAudioPipeline();
		setStatus("Listening. Speak naturally.", "ready");
	} catch (error) {
		console.warn("Microphone unavailable; staying in typed mode.", error);
		setStatus("Mic access failed. Keep typing or retry.", "warning");
	}
}

async function stopSession() {
	if (!state.sessionId) return;

	setStatus("Ending session...", "busy");

	const sessionId = state.sessionId;
	await teardownSession(false);

	try {
		await fetch(`/sessions/${sessionId}`, { method: "DELETE" });
	} catch (error) {
		console.warn("Failed to delete session cleanly:", error);
	}

	state.provider = elements.provider.value;
	renderCapabilityCopy();
	setStatus("Session ended.", "idle");
	fetchAndRenderHistory();
}

async function sendTypedMessage() {
	const text = elements.textMessage.value.trim();
	if (!text) return;

	if (!state.sessionId) {
		await startSession({ activateVoice: false });
		if (!state.sessionId) return;
	}

	elements.textMessage.value = "";
	autoResizeTextarea();
	updateSendButton();
	appendMessage("user", text);
	setStatus("Thinking...", "busy");

	if (state.socket?.readyState === WebSocket.OPEN) {
		sendSocketMessage({ type: "text.send", text });
		return;
	}

	try {
		const response = await fetch(`/sessions/${state.sessionId}/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		});
		
		let data = {};
		try {
			data = await response.json();
		} catch (e) {
			if (!response.ok) {
				throw new Error("Failed connecting to server.");
			}
		}
		
		if (!response.ok) {
			throw new Error(data.error || "Failed to send message.");
		}
	} catch (error) {
		console.error(error);
		setStatus(error instanceof Error ? error.message : String(error), "error");
	}
}

// ── WebSocket ───────────────────────────────────────────────────────────

async function connectSessionSocket() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = `${protocol}//${window.location.host}/sessions/${state.sessionId}/socket`;

	await new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		state.socket = socket;

		socket.addEventListener("open", () => resolve());
		socket.addEventListener("error", () => reject(new Error("Failed to open socket.")), { once: true });
		socket.addEventListener("message", (event) => {
			handleSocketMessage(event.data);
		});
		socket.addEventListener("close", (event) => {
			if (state.socket === socket) {
				state.socket = null;
				syncControls();
				if (state.sessionId && event.code !== 1000) {
					setStatus("Connection closed unexpectedly.", "warning");
				}
			}
		});
	});

	syncControls();
}

// ── Audio pipeline ──────────────────────────────────────────────────────

async function ensureAudioPipeline() {
	if (state.audioContext) return;

	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error("This browser cannot capture microphone audio.");
	}

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			channelCount: 1,
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	});

	const audioContext = new AudioContext();
	await audioContext.resume();
	await audioContext.audioWorklet.addModule(MIC_WORKLET_PATH);

	const source = audioContext.createMediaStreamSource(stream);
	const micNode = new AudioWorkletNode(audioContext, "mic-capture-processor");
	const silentGain = audioContext.createGain();
	silentGain.gain.value = 0;
	
	// Create analyser for equalizer visualization
	const analyser = audioContext.createAnalyser();
	analyser.fftSize = 64;
	analyser.smoothingTimeConstant = 0.5;

	micNode.port.onmessage = (event) => {
		const samples = event.data;
		if (!(samples instanceof Float32Array)) return;
		const pcm = float32ToPcm16(downsample(samples, audioContext.sampleRate, SAMPLE_RATE));
		if (!pcm.byteLength || state.socket?.readyState !== WebSocket.OPEN) return;
		sendSocketMessage({ type: "audio.append", audio: arrayBufferToBase64(pcm.buffer) });
	};

	source.connect(micNode);
	source.connect(analyser); // Connect analyser to source for visualization
	micNode.connect(silentGain);
	silentGain.connect(audioContext.destination);

	state.audioContext = audioContext;
	state.mediaStream = stream;
	state.micSource = source;
	state.micNode = micNode;
	state.silentGain = silentGain;
	state.analyser = analyser;
	state.playbackCursor = audioContext.currentTime;

	syncControls();
	startEqualizerAnimation();
}

async function teardownSession(preserveSessionId) {
	clearPlayback();
	stopEqualizerAnimation();

	if (state.socket) {
		const socket = state.socket;
		state.socket = null;
		socket.close(1000, "client stop");
	}

	if (state.micNode) {
		try { state.micNode.disconnect(); } catch {}
		state.micNode = null;
	}

	if (state.micSource) {
		try { state.micSource.disconnect(); } catch {}
		state.micSource = null;
	}

	if (state.silentGain) {
		try { state.silentGain.disconnect(); } catch {}
		state.silentGain = null;
	}

	if (state.analyser) {
		try { state.analyser.disconnect(); } catch {}
		state.analyser = null;
	}

	if (state.mediaStream) {
		for (const track of state.mediaStream.getTracks()) {
			track.stop();
		}
		state.mediaStream = null;
	}

	if (state.audioContext) {
		try { await state.audioContext.close(); } catch {}
		state.audioContext = null;
	}

	state.assistantDraftId = null;

	if (!preserveSessionId) {
		state.sessionId = null;
	}

	renderSessionMeta();
	renderCapabilityCopy();
	syncControls();
}

// ── Message handling ────────────────────────────────────────────────────

function handleSocketMessage(raw) {
	let message;
	try {
		message = JSON.parse(raw);
	} catch {
		return;
	}

	switch (message.type) {
		case "session.snapshot":
			applySnapshot(message);
			return;
		case "realtime.event":
			handleRealtimeEvent(message.event);
			return;
		case "domain.event":
			handleDomainEvent(message.event);
			return;
		case "error":
			setStatus(message.message || "Socket error.", "error");
			return;
	}
}

function applySnapshot(snapshot) {
	resetConversationState();
	state.provider = snapshot.provider || state.provider;
	state.tasks = new Map((snapshot.tasks || []).map((task) => [task.id, task]));

	const events = Array.isArray(snapshot.events) ? snapshot.events.slice().sort((a, b) => a.timestamp - b.timestamp) : [];
	for (const event of events) {
		if (event.type === "turn.started" && event.transcript) {
			appendMessage("user", event.transcript, { markRecent: false });
		}
		if (event.type === "turn.ended" && event.transcript) {
			appendMessage("user", event.transcript, { markRecent: false });
		}
		if (event.type === "assistant.speaking" && event.text) {
			appendMessage("assistant", event.text, { markRecent: false });
		}
	}

	renderSessionMeta();
	renderCapabilityCopy();
	renderThread();
}

function handleRealtimeEvent(event) {
	switch (event.type) {
		case "input_audio_buffer.speech_started":
			clearPlayback();
			setStatus("Listening...", "listening");
			return;

		case "input_audio_buffer.speech_stopped":
			setStatus("Thinking...", "busy");
			return;

		case "conversation.item.input_audio_transcription.completed":
			appendMessage("user", event.transcript);
			return;

		case "response.audio.delta":
			queueAssistantAudio(event.delta);
			setStatus("Speaking...", "speaking");
			return;

		case "response.audio.done":
			if (state.sessionId) {
				setStatus(state.audioContext ? "Listening. Speak naturally." : "Session ready.", "ready");
			}
			return;

		case "response.text.delta":
			updateAssistantDraft(event.delta);
			return;

		case "response.text.done":
			finalizeAssistantDraft(event.text);
			return;

		case "error":
			setStatus(`${event.code}: ${event.message}`, "error");
			return;

		case "connection.closed":
			setStatus("Transport closed.", "warning");
			return;
	}
}

function handleDomainEvent(event) {
	switch (event.type) {
		case "task.created":
			state.tasks.set(event.task.id, event.task);
			renderThread();
			return;

		case "task.status_changed": {
			const task = state.tasks.get(event.taskId);
			if (task) {
				task.status = event.newStatus;
				task.updatedAt = event.timestamp;
				state.tasks.set(event.taskId, task);
				renderThread();
			}
			return;
		}

		case "task.completed": {
			const task = state.tasks.get(event.taskId);
			if (task) {
				task.status = "completed";
				task.updatedAt = event.timestamp;
				if (event.result) {
					task.result = event.result;
				}
				state.tasks.set(event.taskId, task);
				renderThread();
			}
			return;
		}

		case "task.failed": {
			const task = state.tasks.get(event.taskId);
			if (task) {
				task.status = "failed";
				task.updatedAt = event.timestamp;
				task.error = event.error;
				state.tasks.set(event.taskId, task);
				renderThread();
			}
			return;
		}

		case "assistant.interrupted":
			clearPlayback();
			markAssistantDraftInterrupted();
			setStatus("Reply interrupted.", "listening");
			return;

		case "session.ended":
			if (event.sessionId === state.sessionId) {
				void teardownSession(false).then(() => {
					setStatus(`Session ended (${event.reason}).`, event.reason === "error" ? "error" : "idle");
				});
			}
			return;

		case "turn.ended":
			appendMessage("user", event.transcript);
			return;

		case "assistant.speaking":
			appendMessage("assistant", event.text);
			return;
	}
}

// ── Message state ───────────────────────────────────────────────────────

function appendMessage(role, text, { markRecent = true } = {}) {
	const content = text.trim();
	if (!content) return;

	if (markRecent && isRecentMessage(role, content)) {
		return;
	}

	if (markRecent) {
		rememberMessage(role, content);
	}

	state.messages.push({
		id: createId(),
		role,
		text: content,
		partial: false,
	});
	renderThread();
}

function updateAssistantDraft(delta) {
	if (!delta) return;

	let draft = state.messages.find((message) => message.id === state.assistantDraftId);
	if (!draft) {
		draft = {
			id: createId(),
			role: "assistant",
			text: "",
			partial: true,
		};
		state.assistantDraftId = draft.id;
		state.messages.push(draft);
	}

	draft.text += delta;
	renderThread();
}

function finalizeAssistantDraft(text) {
	const content = text.trim();
	if (!content) return;

	let draft = state.messages.find((message) => message.id === state.assistantDraftId);
	if (!draft) {
		appendMessage("assistant", content);
		return;
	}

	draft.text = content;
	draft.partial = false;
	state.assistantDraftId = null;
	rememberMessage("assistant", content);
	renderThread();
}

function markAssistantDraftInterrupted() {
	if (!state.assistantDraftId) return;

	const draft = state.messages.find((message) => message.id === state.assistantDraftId);
	if (!draft) return;

	draft.partial = false;
	if (!draft.text.endsWith("...")) {
		draft.text = `${draft.text.trim()}...`;
	}
	state.assistantDraftId = null;
	renderThread();
}

// ── Rendering ───────────────────────────────────────────────────────────

function renderThread() {
	elements.transcript.innerHTML = "";

	const hasMessages = state.messages.length > 0;
	const hasTasks = state.tasks.size > 0;

	if (!hasMessages && !hasTasks) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.innerHTML = `
			<div class="empty-icon">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10a10 10 0 0 1-9.49-6.82"/>
					<circle cx="12" cy="12" r="1"/>
					<path d="M2 12h4M12 2v4M18 12h4M12 18v4"/>
				</svg>
			</div>
			<h2>How can I help you today?</h2>
			<p>Start a voice session or type a message below.</p>
		`;
		elements.transcript.append(empty);
		return;
	}

	for (const message of state.messages) {
		const row = document.createElement("div");
		row.className = `message-row ${message.role}`;
		if (message.partial) {
			row.classList.add("partial");
		}

		const header = document.createElement("div");
		header.className = "message-header";

		const avatar = document.createElement("div");
		avatar.className = `message-avatar ${message.role}`;
		avatar.textContent = message.role === "assistant" ? "M" : "Y";

		const roleLabel = document.createElement("span");
		roleLabel.className = "message-role";
		roleLabel.textContent = message.role === "assistant" ? "Merlin" : "You";

		header.append(avatar, roleLabel);

		const body = document.createElement("p");
		body.className = "message-body";
		body.textContent = message.text;

		row.append(header, body);
		elements.transcript.append(row);
	}

	if (hasTasks) {
		const stack = document.createElement("section");
		stack.className = "task-stack";

		for (const task of Array.from(state.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)) {
			const card = document.createElement("article");
			card.className = "task-card";

			const top = document.createElement("div");
			top.className = "task-topline";

			const kind = document.createElement("span");
			kind.className = "task-kind";
			kind.textContent = task.kind;

			const status = document.createElement("span");
			status.className = `task-status status-${task.status}`;
			status.textContent = task.status;

			top.append(kind, status);

			const body = document.createElement("p");
			body.className = "task-intent";
			body.textContent = task.intent;

			const meta = document.createElement("p");
			meta.className = "task-meta";
			meta.textContent = `Task ${task.id}`;

			card.append(top, body, meta);
			stack.append(card);
		}

		elements.transcript.append(stack);
	}

	elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function renderSessionMeta() {
	if (!state.sessionId) {
		elements.sessionMeta.textContent = "Merlin";
		return;
	}

	elements.sessionMeta.textContent = `Merlin · ${state.provider}`;
}

function renderCapabilityCopy() {
	const provider = state.sessionId ? state.provider : elements.provider.value;
	if (provider === "openai") {
		elements.capabilityCopy.textContent = state.audioContext
			? "Voice is live. Keep talking or typing."
			: "OpenAI Realtime supports continuous voice.";
		return;
	}

	elements.capabilityCopy.textContent =
		"MiniMax is text-only in the browser.";
}

function setStatus(text, tone) {
	elements.statusPill.textContent = labelForTone(tone);
	elements.statusPill.className = `status-pill ${tone}`;
	elements.statusCopy.textContent = text;
}

function syncControls() {
	const connected = Boolean(state.sessionId);
	const socketOpen = state.socket?.readyState === WebSocket.OPEN;
	const voiceActive = Boolean(state.audioContext);
	const provider = connected ? state.provider : elements.provider.value;

	// Send button state - enabled for text OR slide-to-talk
	elements.sendText.disabled = false;
	
	// Update send button appearance when voice is active
	if (voiceActive) {
		elements.sendText.classList.add("voice-active");
		elements.sendText.title = "Voice is active - slide to talk";
	} else {
		elements.sendText.classList.remove("voice-active");
		elements.sendText.title = "Send message or slide for voice";
	}

	elements.stopSession.disabled = !connected;
	elements.interruptResponse.disabled = !socketOpen;
	elements.provider.disabled = connected;
	elements.userId.disabled = connected;
	elements.model.disabled = connected;
	elements.voice.disabled = connected;
	elements.instructions.disabled = connected;
}

// ── Audio utilities ─────────────────────────────────────────────────────

function sendSocketMessage(message) {
	if (state.socket?.readyState !== WebSocket.OPEN) return;
	state.socket.send(JSON.stringify(message));
}

function resetConversationState() {
	state.messages = [];
	state.tasks = new Map();
	state.assistantDraftId = null;
	state.recentMessages = new Map();
	renderThread();
}

function queueAssistantAudio(base64) {
	if (!state.audioContext) return;

	const audioBuffer = createAudioBufferFromPcm16(state.audioContext, base64);
	const source = state.audioContext.createBufferSource();
	source.buffer = audioBuffer;
	source.connect(state.audioContext.destination);

	const startAt = Math.max(state.audioContext.currentTime + 0.04, state.playbackCursor);
	source.start(startAt);
	state.playbackCursor = startAt + audioBuffer.duration;
	state.activeSources.add(source);

	source.addEventListener("ended", () => {
		state.activeSources.delete(source);
		source.disconnect();
	});
}

function clearPlayback() {
	if (state.audioContext) {
		state.playbackCursor = state.audioContext.currentTime;
	}

	for (const source of state.activeSources) {
		try { source.stop(); } catch {}
	}

	state.activeSources.clear();
}

function createAudioBufferFromPcm16(audioContext, base64) {
	const buffer = base64ToArrayBuffer(base64);
	const view = new DataView(buffer);
	const length = view.byteLength / 2;
	const audioBuffer = audioContext.createBuffer(1, length, SAMPLE_RATE);
	const channel = audioBuffer.getChannelData(0);

	for (let index = 0; index < length; index += 1) {
		channel[index] = view.getInt16(index * 2, true) / 32_768;
	}

	return audioBuffer;
}

function base64ToArrayBuffer(base64) {
	const binary = window.atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer);
	let binary = "";

	for (let index = 0; index < bytes.length; index += 0x8000) {
		const chunk = bytes.subarray(index, index + 0x8000);
		binary += String.fromCharCode(...chunk);
	}

	return window.btoa(binary);
}

function float32ToPcm16(samples) {
	const pcm = new Int16Array(samples.length);
	for (let index = 0; index < samples.length; index += 1) {
		const sample = Math.max(-1, Math.min(1, samples[index]));
		pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
	}
	return pcm;
}

function downsample(input, sourceRate, targetRate) {
	if (sourceRate === targetRate) {
		return input;
	}

	const ratio = sourceRate / targetRate;
	const outputLength = Math.round(input.length / ratio);
	const output = new Float32Array(outputLength);
	let outputIndex = 0;
	let inputIndex = 0;

	while (outputIndex < outputLength) {
		const nextInputIndex = Math.round((outputIndex + 1) * ratio);
		let sum = 0;
		let count = 0;

		for (let index = inputIndex; index < nextInputIndex && index < input.length; index += 1) {
			sum += input[index];
			count += 1;
		}

		output[outputIndex] = count > 0 ? sum / count : input[inputIndex] || 0;
		outputIndex += 1;
		inputIndex = nextInputIndex;
	}

	return output;
}

function rememberMessage(role, text) {
	const cutoff = Date.now() - 4_000;
	for (const [key, timestamp] of state.recentMessages.entries()) {
		if (timestamp < cutoff) {
			state.recentMessages.delete(key);
		}
	}

	state.recentMessages.set(`${role}:${text}`, Date.now());
}

function isRecentMessage(role, text) {
	const cutoff = Date.now() - 4_000;
	for (const [key, timestamp] of state.recentMessages.entries()) {
		if (timestamp < cutoff) {
			state.recentMessages.delete(key);
		}
	}
	return state.recentMessages.has(`${role}:${text}`);
}

function labelForTone(tone) {
	switch (tone) {
		case "busy":
			return "Thinking";
		case "ready":
			return "Ready";
		case "listening":
			return "Listening";
		case "speaking":
			return "Speaking";
		case "warning":
			return "Limited";
		case "error":
			return "Error";
		default:
			return "Idle";
	}
}

function createId() {
	return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
