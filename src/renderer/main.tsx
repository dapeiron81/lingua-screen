import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Overlay } from './Overlay';
import './styles.css';

const overlay = location.hash === '#overlay';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{overlay ? <Overlay /> : <App />}</React.StrictMode>);
