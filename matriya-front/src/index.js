import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <>
      <App />
      <ToastContainer
        position="top-right"
        theme="dark"
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        limit={3}
        toastStyle={{ background: '#0b1630', border: '1px solid #1e3a5f', color: '#f0f6ff' }}
      />
    </>
  </React.StrictMode>
);
