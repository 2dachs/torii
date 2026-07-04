import React from 'react';
import ReactDOM from 'react-dom/client';
import AgentWindow from './AgentWindow';
import './styles.css';
import './agent-window.css';

console.info('[Torii Agent Window] boot');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgentWindow />
  </React.StrictMode>
);
