import readline from 'readline';

const SERVER_URL = 'http://localhost:3000';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function request(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function start() {
  console.log('🤖 Connecting to Merlin Voice Orchestrator...');
  let session;
  try {
    const data = await request('/sessions', {
      method: 'POST',
      body: JSON.stringify({ userId: 'cli-user' })
    });
    session = data.session;
    console.log(`✅ Session created: ${session.id} (Using provider: ${data.provider})`);
    console.log('Type your message and press Enter (or type "exit" to quit).\n');
  } catch (err) {
    console.error('❌ Failed to connect to server. Is it running on port 3000?');
    console.error(err.message);
    process.exit(1);
  }

  const loop = () => {
    rl.question('👤 You: ', async (text) => {
      if (text.trim().toLowerCase() === 'exit') {
        console.log('Ending session...');
        await request(`/sessions/${session.id}`, { method: 'DELETE' }).catch(() => {});
        rl.close();
        return;
      }

      if (!text.trim()) return loop();

      try {
        await request(`/sessions/${session.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ text })
        });
        console.log('🗣️ Merlin received your message (audio should be playing from the server logs/process)');
        
        // Optionally fetch events:
        const { events } = await request(`/sessions/${session.id}/events`);
        const recentTasks = events.filter(e => e.type.startsWith('task.') && e.timestamp > Date.now() - 5000);
        if (recentTasks.length > 0) {
           console.log(`\n📋 Triggered Tasks:`);
           for (const t of recentTasks) {
             console.log(`   - [${t.type}] ${t.payload?.task?.description || ''}`);
           }
           console.log();
        }

      } catch (err) {
        console.error('❌ Error sending message:', err.message);
      }
      loop();
    });
  };

  loop();
}

start();
