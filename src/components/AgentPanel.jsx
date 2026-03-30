import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PicoCat } from '../App.jsx';

const PICO = {
  orange:'#e8734a', green:'#5cb85c', text:'#2c2416',
  muted:'#9b8e82', border:'#e2d9cf', card:'#ffffff', bg:'#f7f3ee',
};

const ACTION_META = {
  move_right:   { label:'→ right',   color:'#4a90d9' },
  move_left:    { label:'← left',    color:'#4a90d9' },
  move_up:      { label:'↑ up',      color:'#4a90d9' },
  move_down:    { label:'↓ down',    color:'#4a90d9' },
  jump:         { label:'↗ jump',    color:'#5cb85c' },
  push_box:     { label:'📦 push',   color:'#e8734a' },
  wait:         { label:'⏸ wait',    color:'#bbb' },
  press_button: { label:'▼ button',  color:'#9b59b6' },
};

export default function AgentPanel({ agents, log, thinkingAgents, agentReasoning = {}, agentThoughts = {}, state, running }) {
  const logRef = useRef(null);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [copied, setCopied] = useState(false);

  const copyLog = useCallback(() => {
    const text = log.map(e => {
      const tick = String(e.tick || 0).padStart(3, '0');
      if (e.agentId) return `${tick} [${e.agentId}] ${e.text}`;
      return `${tick} ${e.text}`;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [log]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const btns    = state?.buttons || [];
  const doorOpen = state?.door?.open;
  const gateOpen = state?.gate?.open;
  const plateOn  = state?.plate?.activated;
  const exitCol  = state?.goalCol ?? 8;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:11, fontWeight:800, color: PICO.muted, textTransform:'uppercase', letterSpacing:0.5 }}>
          Agent Status
        </span>
        {running && (
          <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color: PICO.orange, fontWeight:700 }}>
            <div style={{
              width:7, height:7, borderRadius:'50%', backgroundColor: PICO.orange,
              animation:'dotBounce 0.8s ease-in-out infinite',
            }}/>
            Live
          </div>
        )}
      </div>

      {/* Agent cards */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {agents.map(agent => {
          const isThinking = thinkingAgents.has(agent.id);
          const reasoning  = agentReasoning[agent.id] || '';
          const thought    = agentThoughts[agent.id]  || '';
          const actionMeta = ACTION_META[agent.lastAction] || null;
          const isExpanded = expandedAgent === agent.id;
          const inExit     = agent.col >= exitCol;

          return (
            <div key={agent.id} style={{
              backgroundColor: PICO.card,
              border:`2px solid ${isThinking ? agent.color : PICO.border}`,
              borderLeft:`4px solid ${agent.color}`,
              borderRadius:12,
              overflow:'hidden',
              transition:'border-color 0.2s, box-shadow 0.2s',
              boxShadow: isThinking ? `0 0 0 3px ${agent.color}33` : 'none',
            }}>
              {/* Card header */}
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px' }}>
                {/* Cat avatar */}
                <div style={{ position:'relative', flexShrink:0 }}>
                  <PicoCat
                    color={agent.color}
                    size={32}
                    style={{ animation: isThinking ? 'agentBounce 0.7s ease-in-out infinite' : 'none' }}
                  />
                  {inExit && (
                    <span style={{
                      position:'absolute', top:-4, right:-4, fontSize:10,
                      backgroundColor:'#fff', borderRadius:'50%', width:14, height:14,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>✓</span>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:13, fontWeight:900, color: PICO.text }}>Agent {agent.id}</span>
                    <span style={{ fontSize:10, fontFamily:'monospace', color: PICO.muted }}>
                      ({agent.col},{agent.row})
                    </span>
                    {inExit && (
                      <span style={{
                        fontSize:9, fontWeight:800, color: PICO.green,
                        backgroundColor:'#eaf7ea', border:`1px solid #c3e6c3`,
                        padding:'1px 5px', borderRadius:10,
                      }}>EXIT</span>
                    )}
                  </div>

                  {isThinking ? (
                    <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                      {[0,1,2].map(i=>(
                        <div key={i} style={{
                          width:5, height:5, borderRadius:'50%',
                          backgroundColor: agent.color,
                          animation:`dotBounce 0.8s ${i*0.15}s ease-in-out infinite`,
                        }}/>
                      ))}
                      <span style={{ fontSize:10, color: PICO.muted }}>thinking…</span>
                    </div>
                  ) : thought ? (
                    <div style={{ fontSize:11, color: PICO.muted, marginTop:2, lineHeight:1.3,
                      display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {thought}
                    </div>
                  ) : (
                    <div style={{ fontSize:11, color:'#ccc', marginTop:2 }}>idle</div>
                  )}
                </div>

                {/* Action pill */}
                {actionMeta && !isThinking && (
                  <span style={{
                    fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:12, flexShrink:0,
                    backgroundColor: actionMeta.color + '18',
                    color: actionMeta.color,
                    border:`1px solid ${actionMeta.color}44`,
                  }}>{actionMeta.label}</span>
                )}
              </div>

              {/* Reasoning toggle */}
              {reasoning && !isThinking && (
                <div style={{ borderTop:`1px solid ${PICO.border}` }}>
                  <button
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    style={{
                      width:'100%', textAlign:'left', padding:'5px 12px',
                      fontSize:10, fontWeight:700, color: PICO.muted,
                      background:'none', border:'none', cursor:'pointer',
                      display:'flex', alignItems:'center', gap:4,
                    }}
                  >
                    <span>{isExpanded ? '▾' : '▸'}</span>
                    <span>View reasoning</span>
                  </button>
                  {isExpanded && (
                    <div style={{
                      padding:'0 12px 10px',
                      fontSize:10, color: PICO.muted, lineHeight:1.5,
                      fontFamily:'monospace', whiteSpace:'pre-wrap', wordBreak:'break-word',
                      maxHeight:120, overflowY:'auto',
                      backgroundColor:'#faf8f5',
                    }}>
                      {reasoning}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* State pills */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {btns.map(b => (
          <Pill key={b.id} label={b.id} active={b.pressed} info={b.pressed ? b.pressedBy : '—'} color='#9b59b6' />
        ))}
        {state?.plate && (
          <Pill label="plate" active={plateOn} info={plateOn ? 'on' : 'empty'} color='#8e44ad' />
        )}
        {state?.door && (
          <Pill label="door" active={doorOpen} info={doorOpen ? 'open' : 'closed'} color={PICO.green} />
        )}
        {state?.gate && (
          <Pill label="gate" active={gateOpen} info={gateOpen ? 'open' : 'closed'} color='#f0a500' />
        )}
        {(state?.agentsAtGoal?.length || 0) > 0 && (
          <Pill label="exit" active info={`[${state.agentsAtGoal.join('')}]`} color={PICO.green} />
        )}
      </div>

      {/* Log */}
      <div style={{
        backgroundColor: PICO.card,
        border:`2px solid ${PICO.border}`,
        borderRadius:12, overflow:'hidden',
      }}>
        <div style={{ padding:'8px 12px', borderBottom:`1px solid ${PICO.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:11, fontWeight:800, color: PICO.muted, textTransform:'uppercase', letterSpacing:0.5 }}>Event Log</span>
          <button
            onClick={copyLog}
            title="Copy full event log"
            style={{
              display:'flex', alignItems:'center', gap:4,
              padding:'3px 8px', borderRadius:6,
              border:`1px solid ${copied ? PICO.green : PICO.border}`,
              backgroundColor: copied ? '#eaf7ea' : '#fff',
              color: copied ? PICO.green : PICO.muted,
              fontSize:10, fontWeight:700, cursor:'pointer',
              transition:'all 0.15s',
            }}
          >
            {copied ? (
              <><span>✓</span><span>Copied</span></>
            ) : (
              <><CopyIcon /><span>Copy</span></>
            )}
          </button>
        </div>
        <div
          ref={logRef}
          style={{ padding:10, fontFamily:'monospace', fontSize:11, color: PICO.text, overflowY:'auto', maxHeight:260, minHeight:80 }}
        >
          {log.length === 0 && (
            <div style={{ color: PICO.muted, textAlign:'center', padding:'16px 0', fontStyle:'italic' }}>
              Press ▶ Run to start
            </div>
          )}
          {log.map((entry, i) => <LogLine key={i} entry={entry} />)}
        </div>
      </div>
    </div>
  );
}

const AGENT_COLORS = { A:'#ff6b6b', B:'#4ecdc4', C:'#ffe66d', D:'#a8e6cf' };

function LogLine({ entry }) {
  const agentColor = entry.agentId ? AGENT_COLORS[entry.agentId] : null;
  if (entry.type === 'win') {
    return (
      <div style={{ margin:'4px 0', padding:'5px 8px', backgroundColor:'#eaf7ea', borderRadius:6, fontWeight:700, color:'#2d5a2d', textAlign:'center' }}>
        {entry.text}
      </div>
    );
  }
  return (
    <div style={{ display:'flex', gap:6, marginBottom:3, lineHeight:1.4 }}>
      <span style={{ color:'#ccc', flexShrink:0, fontFamily:'monospace' }}>{String(entry.tick||0).padStart(3,'0')}</span>
      {agentColor && (
        <span style={{ color: agentColor, fontWeight:800, flexShrink:0 }}>[{entry.agentId}]</span>
      )}
      <span style={{ color: entry.type === 'action' ? '#555' : entry.type === 'message' ? '#4a90d9' : entry.type === 'system' ? '#9b59b6' : '#555', wordBreak:'break-word', minWidth:0 }}>
        {entry.text}
      </span>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function Pill({ label, active, info, color }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:4,
      padding:'3px 8px', borderRadius:20,
      fontSize:10, fontWeight:700,
      backgroundColor: active ? color + '18' : '#f5f0ea',
      border:`1.5px solid ${active ? color : PICO.border}`,
      color: active ? color : PICO.muted,
    }}>
      <div style={{ width:5, height:5, borderRadius:'50%', backgroundColor: active ? color : '#ccc' }} />
      <span>{label}</span>
      <span style={{ opacity:0.65 }}>{info}</span>
    </div>
  );
}
