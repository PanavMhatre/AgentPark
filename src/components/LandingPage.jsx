import React from 'react';
import { PicoCat } from '../App.jsx';

const CAT_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf'];

export default function LandingPage({ onSelect }) {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f0f0f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Nunito','Segoe UI',system-ui,sans-serif",
      color: '#fff',
      padding: '40px 24px',
      boxSizing: 'border-box',
    }}>

      {/* Mascots */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 36 }}>
        {CAT_COLORS.map((c, i) => (
          <div key={i} style={{
            animation: `catBounce 1.2s ${i * 0.18}s ease-in-out infinite`,
          }}>
            <PicoCat color={c} size={64} />
          </div>
        ))}
      </div>

      {/* Headline */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 'clamp(48px, 8vw, 80px)', fontWeight: 900, letterSpacing: 4, lineHeight: 1 }}>
          <span style={{ color: '#e8734a' }}>AGENT</span>
          <span style={{ color: '#fff' }}> PARK</span>
        </div>
        <div style={{
          fontSize: 'clamp(13px, 2vw, 16px)',
          color: '#888',
          marginTop: 10,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>
          Pico Park · Solved by AI Agents
        </div>
      </div>

      {/* Subtitle */}
      <p style={{
        maxWidth: 480,
        textAlign: 'center',
        color: '#aaa',
        fontSize: 15,
        lineHeight: 1.7,
        marginBottom: 44,
      }}>
        4 cooperative agents, 4 puzzle levels. Watch <span style={{ color: '#e8734a', fontWeight: 700 }}>LLMs coordinate in real time</span> to solve platformer puzzles — or run the deterministic demo.
      </p>

      {/* CTA buttons */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 60 }}>
        <button
          onClick={() => onSelect('human')}
          style={{
            padding: '14px 32px',
            borderRadius: 12,
            border: '2px solid #333',
            backgroundColor: '#1a1a1a',
            color: '#fff',
            fontWeight: 800,
            fontSize: 16,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            letterSpacing: 0.5,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.border = '2px solid #4a90d9';
            e.currentTarget.style.backgroundColor = '#1e2a3a';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.border = '2px solid #333';
            e.currentTarget.style.backgroundColor = '#1a1a1a';
          }}
        >
          👤 I'm a Human
        </button>

        <button
          onClick={() => onSelect('agent')}
          style={{
            padding: '14px 32px',
            borderRadius: 12,
            border: '2px solid #e8734a',
            backgroundColor: '#e8734a',
            color: '#fff',
            fontWeight: 800,
            fontSize: 16,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            letterSpacing: 0.5,
            boxShadow: '0 4px 0 #b85a35',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = '#d4653f';
            e.currentTarget.style.border = '2px solid #d4653f';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = '#e8734a';
            e.currentTarget.style.border = '2px solid #e8734a';
          }}
        >
          🤖 I'm an AI Agent
        </button>
      </div>

      {/* Info cards */}
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center',
        maxWidth: 680, width: '100%', marginBottom: 48,
      }}>
        {[
          { icon: '👤', title: "I'm a Human", desc: 'Watch the deterministic demo — see the perfect solution play out step by step.' },
          { icon: '🤖', title: "I'm an AI Agent", desc: 'Watch LLMs reason and cooperate using Groq API. Each tick is a real LLM call.' },
        ].map(card => (
          <div key={card.title} style={{
            flex: '1 1 280px',
            backgroundColor: '#161616',
            border: '1px solid #2a2a2a',
            borderRadius: 14,
            padding: '20px 24px',
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, color: '#fff' }}>{card.title}</div>
            <div style={{ fontSize: 13, color: '#777', lineHeight: 1.6 }}>{card.desc}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ color: '#444', fontSize: 12, textAlign: 'center' }}>
        <a
          href="https://github.com/PanavMhatre/AgentPark"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#555', textDecoration: 'none' }}
        >
          github.com/PanavMhatre/AgentPark
        </a>
      </div>

      <style>{`
        @keyframes catBounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-14px); }
        }
      `}</style>
    </div>
  );
}
