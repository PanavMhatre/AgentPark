# Agent Park

> Pico Park, solved by AI agents in real time.

**Live demo: [agent-pico-park.vercel.app](https://agent-pico-park.vercel.app)**

4 cooperative LLM agents (A, B, C, D) work together to complete cooperative platformer puzzles — pressing buttons, collecting keys, crossing gates, and avoiding hazards. Each tick is a real Groq LLM call; the agents reason about each other's positions and coordinate their moves.

---

## What is this?

Agent Park is a browser-based cooperative platformer where the players are AI agents powered by [Groq](https://groq.com). Inspired by Pico Park, each level requires all 4 agents to cooperate — one agent can't win alone.

- **Human mode** — watch a deterministic demo solution play out
- **AI Agent mode** — watch live LLM calls reason about the game state and coordinate actions

---

## Levels

| # | Name | Challenge |
|---|------|-----------|
| 1 | Button Sequence | Press btn1 then btn2 in order to open the gate |
| 2 | Key & Gate | One agent collects the key; all cross the gate |
| 3 | Oscillating Gate | A gate opens and closes on a timer — time the crossing |
| 4 | Pit Gauntlet | Navigate a field of fatal pits using jump timing |

---

## Tech Stack

- **React 18 + Vite** — game loop with `requestAnimationFrame` blending
- **Groq API** — `llama-3.1-8b-instant` for fast LLM inference
- **No backend** — runs entirely in the browser; API keys in `.env.local`

---

## Setup

```bash
git clone https://github.com/PanavMhatre/AgentPark
cd AgentPark
npm install
```

Create `.env.local` with your Groq API keys:

```
VITE_GROQ_KEY_1=gsk_...
VITE_GROQ_KEY_2=gsk_...
VITE_GROQ_KEY_3=gsk_...
VITE_GROQ_KEY_4=gsk_...
```

Get a free API key at [console.groq.com](https://console.groq.com). Multiple keys are used in rotation to stay within rate limits.

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and choose your mode.

---

## How the AI Works

Each game tick:

1. **Sticky assignments** — each unpressed button is assigned to its nearest agent and locked in across ticks
2. **Deterministic path** — assigned agents follow a rule-based path to their button (no LLM needed)
3. **LLM reasoning** — free agents call Groq with the full game state, level rules, and suggested actions
4. **JSON parsing** — responses are parsed with a rescue parser that handles truncated outputs
5. **Rate limit handling** — 1.5s gap between ticks; automatic retry with exponential backoff

The LLM receives: agent positions, button states, key/gate status, stuck-tick counts, and what each agent's last action was.

---

## Project Structure

```
src/
  agentAI.js       — LLM coordinator, sticky assignments, deterministic paths
  gameEngine.js    — step simulation, physics, collision, button activation
  levels.js        — level definitions (grid, agents, buttons, gates, hazards)
  motionConfig.js  — animation timing per action type
  App.jsx          — game loop, RAF blending, UI shell
  components/
    LandingPage.jsx — dark landing page with mode selection
    GameScene.jsx   — canvas-style platformer renderer
    AgentPanel.jsx  — agent status + action log
```

---

## License

MIT
